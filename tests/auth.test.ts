import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { connectApiKey, disconnectAuth, finishChatGPTLogin, getAIConnection, getAuthStatus, startChatGPTLogin } from '../server/auth.js'

const CALLBACK = 'http://127.0.0.1:4310/api/auth/callback'
const ISSUER = 'https://auth.openai.com'
const SCOPES = 'openid email offline_access resource.invoke chatgpt.tokens.use.direct'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }
function jwt(nonce: string, extra: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: ISSUER, sub: 'user-123', aud: 'oaiapp_test', exp: now + 3600, iat: now, nonce, email: 'owner@example.test', ...extra })).toString('base64url')
  return `${header}.${claims}.${sign('sha256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
async function setup(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forma-auth-'))
  const originalFetch = globalThis.fetch; const originalDirectory = process.env.FORMA_DATA_DIR; const originalModel = process.env.FORMA_MODEL
  process.env.FORMA_DATA_DIR = directory; delete process.env.FORMA_MODEL
  t.after(async () => { globalThis.fetch = originalFetch; if (originalDirectory) process.env.FORMA_DATA_DIR = originalDirectory; else delete process.env.FORMA_DATA_DIR; if (originalModel) process.env.FORMA_MODEL = originalModel; else delete process.env.FORMA_MODEL; await rm(directory, { recursive: true, force: true }) })
  return directory
}
function oauthFetch(nonce: string, options: { claims?: Record<string, unknown>; scopes?: string; token?: string; exchange?: (body: URLSearchParams) => void } = {}) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const value = String(url)
    if (value.endsWith('/openid-configuration')) return json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/revoke` })
    if (value.endsWith('/jwks.json')) return json({ keys: [jwk] })
    if (value.endsWith('/oauth/token')) {
      options.exchange?.(new URLSearchParams(String(init?.body)))
      return json({ access_token: 'access-test-secret', refresh_token: 'refresh-test-secret', id_token: options.token || jwt(nonce, options.claims), token_type: 'Bearer', expires_in: 3600, scope: options.scopes ?? SCOPES })
    }
    if (value.endsWith('/models')) return json({ models: [{ slug: 'gpt-6.1-sol', visibility: 'list' }] })
    if (value.endsWith('/revoke')) return new Response(null, { status: 200 })
    throw new Error('Unexpected mock request')
  }) as typeof fetch
}

test('OAuth uses independent dynamic registration and validates a signed identity; credentials stay private', async t => {
  const directory = await setup(t)
  assert.deepEqual(await getAuthStatus(), { connected: false, provider: null })
  const url = new URL((await startChatGPTLogin(CALLBACK)).url)
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(url.searchParams.get('agent_name_hint'), 'Forma CMS')
  assert.equal(url.searchParams.get('redirect_uri'), CALLBACK)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(url.searchParams.get('ext_agent_host_id')?.startsWith('urn:uuid:'))
  const host = url.searchParams.get('ext_agent_host_id')
  globalThis.fetch = oauthFetch(url.searchParams.get('nonce')!, { exchange(body) {
    assert.equal(body.get('client_id'), 'oaiapp_test')
    assert.equal(body.get('redirect_uri'), CALLBACK)
    assert.equal(body.get('resource'), 'https://api.openai.com/v1')
    assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), url.searchParams.get('code_challenge'))
  } })
  await finishChatGPTLogin({ state: url.searchParams.get('state')!, code: 'one-use-code', client_id: 'oaiapp_test' }, CALLBACK)
  const status = await getAuthStatus()
  assert.equal(status.connected, true)
  assert.equal(status.email, 'owner@example.test')
  assert.doesNotMatch(JSON.stringify(status), /access-test|refresh-test|idToken|apiKey/)
  assert.equal((await stat(path.join(directory, 'auth.json'))).mode & 0o777, 0o600)
  const again = new URL((await startChatGPTLogin(CALLBACK)).url)
  assert.equal(again.searchParams.get('client_id'), 'oaiapp_test')
  assert.equal(again.searchParams.get('ext_agent_host_id'), host)
  assert.equal(again.searchParams.has('agent_name_hint'), false)
  assert.equal(again.searchParams.has('id_token_hint'), false)
  assert.notEqual(again.searchParams.get('state'), url.searchParams.get('state'))
  assert.equal((await getAIConnection()).model, 'gpt-6.1-sol')
  await disconnectAuth()
  const saved = JSON.parse(await readFile(path.join(directory, 'auth.json'), 'utf8'))
  assert.equal(saved.hostId, host)
  assert.equal(saved.registration.clientId, 'oaiapp_test')
  assert.equal(saved.connection, undefined)
  assert.equal((await getAuthStatus()).connected, false)
})

test('OAuth rejects mismatched state without consuming the legitimate callback and rejects replay', async t => {
  await setup(t)
  const url = new URL((await startChatGPTLogin(CALLBACK)).url)
  globalThis.fetch = oauthFetch(url.searchParams.get('nonce')!)
  await assert.rejects(finishChatGPTLogin({ state: 'wrong', code: 'code', client_id: 'oaiapp_test' }, CALLBACK), /не принадлежит/)
  const query = { state: url.searchParams.get('state')!, code: 'code', client_id: 'oaiapp_test' }
  await finishChatGPTLogin(query, CALLBACK)
  await assert.rejects(finishChatGPTLogin(query, CALLBACK), /не принадлежит/)
  await assert.rejects(startChatGPTLogin('http://localhost:4310/api/auth/callback'), /только/)
})

test('OAuth refuses unsigned/invalid claims, stale transactions and missing plan permission', async t => {
  await setup(t)
  for (const claims of [{ nonce: 'wrong' }, { aud: 'other-client' }, { iss: 'https://attacker.example' }, { exp: 1 }, { sub: '' }, { iat: 1 }]) {
    const url = new URL((await startChatGPTLogin(CALLBACK)).url)
    globalThis.fetch = oauthFetch(url.searchParams.get('nonce')!, { claims })
    await assert.rejects(finishChatGPTLogin({ state: url.searchParams.get('state')!, code: 'code', client_id: 'oaiapp_test' }, CALLBACK), /проверить/)
    assert.equal((await getAuthStatus()).connected, false)
  }
  const url = new URL((await startChatGPTLogin(CALLBACK)).url)
  globalThis.fetch = oauthFetch(url.searchParams.get('nonce')!, { scopes: 'openid email profile' })
  await assert.rejects(finishChatGPTLogin({ state: url.searchParams.get('state')!, code: 'code', client_id: 'oaiapp_test' }, CALLBACK), /не разрешил/)
  assert.equal((await getAuthStatus()).connected, false)
  const expired = new URL((await startChatGPTLogin(CALLBACK)).url)
  const realNow = Date.now
  try {
    Date.now = () => realNow() + 11 * 60_000
    await assert.rejects(finishChatGPTLogin({ state: expired.searchParams.get('state')!, code: 'code', client_id: 'oaiapp_test' }, CALLBACK), /Время входа истекло/)
  } finally { Date.now = realNow }
})

test('OAuth returns to issued client after invalid_grant, then serializes and persists rotating refresh', async t => {
  const directory = await setup(t)
  const initial = new URL((await startChatGPTLogin(CALLBACK)).url)
  globalThis.fetch = (async () => json({ error: 'invalid_grant' }, 400)) as typeof fetch
  await assert.rejects(finishChatGPTLogin({ state: initial.searchParams.get('state')!, code: 'used-code', client_id: 'oaiapp_test' }, CALLBACK), /заново/)
  const retry = new URL((await startChatGPTLogin(CALLBACK)).url)
  assert.equal(retry.searchParams.get('client_id'), 'oaiapp_test')
  globalThis.fetch = oauthFetch(retry.searchParams.get('nonce')!)
  await finishChatGPTLogin({ state: retry.searchParams.get('state')!, code: 'fresh-code' }, CALLBACK)
  const file = path.join(directory, 'auth.json')
  const saved = JSON.parse(await readFile(file, 'utf8'))
  saved.connection.expiresAt = Date.now() - 1; saved.connection.model = 'gpt-6.1-sol'
  await writeFile(file, JSON.stringify(saved), { mode: 0o600 })
  let refreshes = 0
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body))
    assert.equal(body.get('grant_type'), 'refresh_token')
    assert.equal(body.get('client_id'), 'oaiapp_test')
    assert.equal(body.get('refresh_token'), 'refresh-test-secret')
    assert.equal(body.has('scope'), false)
    refreshes++
    return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, scope: SCOPES, token_type: 'Bearer' })
  }) as typeof fetch
  const connections = await Promise.all([getAIConnection(), getAIConnection()])
  assert.equal(refreshes, 1)
  assert.ok(connections.every(connection => connection.token === 'new-access'))
  assert.equal(JSON.parse(await readFile(file, 'utf8')).connection.refreshToken, 'new-refresh')
})

test('API keys validate model access and are never returned to browser status', async t => {
  await setup(t)
  globalThis.fetch = (async () => json({ data: [{ id: 'test-model' }] })) as typeof fetch
  const status = await connectApiKey('sk-test-key-long-enough-for-validation', 'test-model')
  assert.deepEqual(status, { connected: true, provider: 'api-key', model: 'test-model' })
  await assert.rejects(connectApiKey('sk-test-key-long-enough-for-validation', 'missing'), /недоступна/)
  assert.equal((await getAuthStatus()).model, 'test-model')
  await disconnectAuth()
  await assert.rejects(getAIConnection(), /Подключите/)
})
