import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AuthStatus } from '../shared/types.js'

// Local, single-user OAuth client. No Codex credentials or shared client ID are reused.
const ISSUER = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const CALLBACK = 'http://127.0.0.1:4310/api/auth/callback'
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
const DEFAULT_MODEL = 'gpt-6.1-sol'
interface Registration { clientId: string; subject: string; email?: string }
interface OAuthConnection extends Registration {
  provider: 'chatgpt'; accessToken: string; refreshToken?: string; idToken: string
  expiresAt: number; scopes: string[]; model?: string
}
interface KeyConnection { provider: 'api-key'; apiKey: string; model: string }
interface AuthFile { version: 1; hostId: string; registration?: Registration; retryClientId?: string; connection?: OAuthConnection | KeyConnection; error?: string }
interface Attempt { state: string; nonce: string; verifier: string; callback: string; createdAt: number; registration?: Registration; issuedClientId?: string }
interface TokenResponse { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; token_type?: string; error?: string }
interface Identity { sub: string; email?: string }
export interface AIConnection { provider: 'chatgpt' | 'api-key'; token: string; model: string }
class ProviderError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) { super(message) }
}

let pending: Attempt | undefined
let serial: Promise<unknown> = Promise.resolve()
function locked<T>(work: () => Promise<T>): Promise<T> {
  const result = serial.then(work, work)
  serial = result.catch(() => {})
  return result
}
function dataDir() { return path.resolve(process.env.FORMA_DATA_DIR || '.data') }
async function load(): Promise<AuthFile> {
  try {
    const data = JSON.parse(await readFile(path.join(dataDir(), 'auth.json'), 'utf8')) as AuthFile
    if (data.version !== 1 || typeof data.hostId !== 'string') throw new Error('Invalid credentials format')
    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hostId: `urn:uuid:${randomUUID()}` }
    throw new Error('Не удалось прочитать защищённые настройки подключения ИИ.')
  }
}
async function save(data: AuthFile) {
  const directory = dataDir()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = path.join(directory, `.auth-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
  await rename(temporary, path.join(directory, 'auth.json'))
  await chmod(path.join(directory, 'auth.json'), 0o600)
}
const random = () => randomBytes(32).toString('base64url')
function same(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
function callbackCheck(callback: string) {
  if (callback !== CALLBACK) throw new Error('OAuth доступен только через http://127.0.0.1:4310/api/auth/callback.')
}
function scopesCheck(scopes: string[]) {
  if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke')) {
    throw new Error('ChatGPT не разрешил использование ИИ. Повторите вход и разрешите доступ к тарифу ChatGPT.')
  }
}
function status(data: AuthFile): AuthStatus {
  const connection = data.connection
  if (!connection) return { connected: false, provider: null, ...(data.error ? { error: data.error } : {}) }
  if (connection.provider === 'api-key') return { connected: true, provider: 'api-key', model: connection.model, ...(data.error ? { error: data.error } : {}) }
  const connected = connection.scopes.includes('chatgpt.tokens.use.direct') && (connection.expiresAt > Date.now() || !!connection.refreshToken)
  return { connected, provider: 'chatgpt', email: connection.email, model: connection.model, ...(data.error ? { error: data.error } : {}) }
}
export async function getAuthStatus(): Promise<AuthStatus> { return locked(async () => status(await load())) }

export function providerError(statusCode: number, body?: unknown): Error {
  const data = body as { error?: { code?: string } | string; code?: string } | undefined
  const candidate = typeof data?.error === 'string' ? data.error : data?.error?.code || data?.code || ''
  // Never echo provider bodies: they can contain prompts, credentials, or arbitrary HTML.
  const code = /^[a-z0-9_]{1,100}$/i.test(candidate) ? candidate : ''
  if (code === 'invalid_grant' || statusCode === 401) return new ProviderError('Авторизация ИИ истекла или отозвана. Подключите аккаунт заново.', statusCode, code)
  if (statusCode === 429 || /usage_limit|usage_unavailable|insufficient_quota/.test(code)) return new ProviderError('Лимит ИИ исчерпан или временно недоступен. Проверьте лимиты подключённого аккаунта.', statusCode, code)
  if (statusCode === 403) return new ProviderError('Аккаунту не разрешён доступ к выбранной модели или функции ИИ.', statusCode, code)
  return new ProviderError(`Провайдер ИИ отклонил запрос (${statusCode}${code ? `, ${code}` : ''}). Проверьте модель и доступ аккаунта.`, statusCode, code)
}
async function jsonRequest(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response
  try { response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000), redirect: 'error' }) }
  catch { throw new Error('Не удалось связаться с OpenAI. Проверьте подключение и повторите попытку.') }
  let body: Record<string, unknown>
  try { body = await response.json() as Record<string, unknown> }
  catch { throw new Error(`OpenAI вернул некорректный ответ (${response.status}).`) }
  if (!response.ok) throw providerError(response.status, body)
  return body
}
async function discovery(): Promise<{ jwks_uri: string; revocation_endpoint?: string }> {
  const config = await jsonRequest(`${ISSUER}/.well-known/openid-configuration`)
  if (config.issuer !== ISSUER || typeof config.jwks_uri !== 'string' || new URL(config.jwks_uri).origin !== ISSUER) throw new Error('Не удалось проверить настройки OpenAI OAuth.')
  if (config.revocation_endpoint && (typeof config.revocation_endpoint !== 'string' || new URL(config.revocation_endpoint).origin !== ISSUER)) throw new Error('Некорректный адрес отзыва OpenAI OAuth.')
  return config as { jwks_uri: string; revocation_endpoint?: string }
}
async function verifyIdentity(token: string, clientId: string, nonce?: string, createdAt?: number): Promise<Identity> {
  try {
    if (token.length > 32_768) throw new Error()
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) throw new Error()
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string; crit?: unknown }
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>
    if (!['RS256', 'ES256'].includes(header.alg || '') || !header.kid || header.crit) throw new Error()
    const config = await discovery()
    const jwks = await jsonRequest(config.jwks_uri)
    const keys = jwks.keys as (JsonWebKey & { kid?: string; use?: string; alg?: string })[]
    const key = Array.isArray(keys) ? keys.find(k => k.kid === header.kid && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg)) : undefined
    if (!key || (header.alg === 'RS256' && key.kty !== 'RSA') || (header.alg === 'ES256' && (key.kty !== 'EC' || key.crv !== 'P-256'))) throw new Error()
    const publicKey = createPublicKey({ key, format: 'jwk' })
    const verified = verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url'))
    const now = Math.floor(Date.now() / 1000)
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!verified || claims.iss !== ISSUER || !audiences.includes(clientId) || (audiences.length > 1 && claims.azp !== clientId)) throw new Error()
    if (typeof claims.exp !== 'number' || claims.exp <= now - 5 || typeof claims.iat !== 'number' || claims.iat > now + 5) throw new Error()
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 5)) throw new Error()
    if (createdAt && claims.iat < Math.floor(createdAt / 1000) - 60) throw new Error()
    if (nonce !== undefined && (typeof claims.nonce !== 'string' || !same(claims.nonce, nonce))) throw new Error()
    if (typeof claims.sub !== 'string' || !claims.sub) throw new Error()
    return { sub: claims.sub, ...(typeof claims.email === 'string' ? { email: claims.email } : {}) }
  } catch { throw new Error('Не удалось проверить подпись или данные аккаунта ChatGPT. Начните вход заново.') }
}
function tokenFields(token: TokenResponse, previousScopes?: string[]) {
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer' || typeof token.expires_in !== 'number' || token.expires_in <= 0) throw new Error('OpenAI вернул неполные данные подключения.')
  const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : previousScopes || []
  scopesCheck(scopes)
  return { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000, scopes }
}

export async function startChatGPTLogin(callbackUrl: string): Promise<{ url: string }> {
  callbackCheck(callbackUrl)
  return locked(async () => {
    const data = await load()
    delete data.error
    await save(data) // Persist the stable host ID before registration starts.
    const attempt: Attempt = { state: random(), nonce: random(), verifier: random(), callback: callbackUrl, createdAt: Date.now(), registration: data.registration, issuedClientId: data.retryClientId }
    pending = attempt
    const clientId = attempt.registration?.clientId || attempt.issuedClientId || 'dynamic_agent_client'
    const url = new URL(`${ISSUER}/api/accounts/authorize`)
    url.search = new URLSearchParams({ client_id: clientId, ext_agent_host_id: data.hostId, response_type: 'code', redirect_uri: callbackUrl, scope: SCOPES, resource: RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }).toString()
    if (clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', 'Forma CMS')
    if (attempt.registration?.email) url.searchParams.set('login_hint', attempt.registration.email)
    // No id_token_hint: this URL passes through the browser UI; credentials stay server-side.
    return { url: url.toString() }
  })
}

export async function finishChatGPTLogin(query: Record<string, string>, callbackUrl: string): Promise<void> {
  callbackCheck(callbackUrl)
  return locked(async () => {
    const attempt = pending
    if (!attempt || !query.state || !same(query.state, attempt.state) || attempt.callback !== callbackUrl) throw new Error('Этот запрос входа не принадлежит текущей сессии. Начните вход заново.')
    pending = undefined // Consume before network I/O; callback replay cannot exchange another code.
    const data = await load()
    try {
      if (Date.now() - attempt.createdAt > 10 * 60_000) throw new Error('Время входа истекло. Подключите ChatGPT ещё раз.')
      if (query.error) throw new Error('Вход в ChatGPT отменён или не разрешён.')
      if (!query.code || query.code.length > 4096) throw new Error('OpenAI не вернул код авторизации.')
      const savedClientId = attempt.registration?.clientId || attempt.issuedClientId
      const clientId = savedClientId || query.client_id
      if (!clientId || clientId === 'dynamic_agent_client' || !/^[\w-]{5,256}$/.test(clientId)) throw new Error('Регистрация ChatGPT не завершена: отсутствует выданный client_id.')
      if (savedClientId && query.client_id && query.client_id !== clientId) throw new Error('OpenAI вернул другую регистрацию. Вход отклонён.')
      // Retain an issued registration for a fresh code after invalid_grant, without trusting its identity yet.
      if (!data.registration) data.retryClientId = clientId
      const token = await jsonRequest(`${ISSUER}/api/accounts/oauth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: query.code, code_verifier: attempt.verifier, redirect_uri: attempt.callback, resource: RESOURCE }),
      }) as TokenResponse
      if (!token.id_token) throw new Error('OpenAI не вернул ID token для проверки аккаунта.')
      const identity = await verifyIdentity(token.id_token, clientId, attempt.nonce, attempt.createdAt)
      if (attempt.registration && identity.sub !== attempt.registration.subject) throw new Error('Вход выполнен под другим аккаунтом. Сохранённое подключение не изменено.')
      const fields = tokenFields(token)
      const registration: Registration = { clientId, subject: identity.sub, email: identity.email }
      data.registration = registration
      delete data.retryClientId
      data.connection = { provider: 'chatgpt', ...registration, ...fields, idToken: token.id_token, refreshToken: token.refresh_token }
      delete data.error
      await save(data)
    } catch (error) {
      if (!(error instanceof ProviderError && error.code === 'invalid_grant')) delete data.retryClientId
      data.error = error instanceof Error ? error.message : 'Не удалось подключить ChatGPT.'
      await save(data)
      throw error
    }
  })
}

async function modelFor(token: string, provider: 'chatgpt' | 'api-key', preferred?: string, signal?: AbortSignal): Promise<string> {
  const data = await jsonRequest(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, signal })
  const models = provider === 'chatgpt'
    ? (Array.isArray(data.models) ? data.models : []).filter((model: { visibility?: string }) => model.visibility === 'list').map((model: { slug?: string }) => model.slug)
    : (Array.isArray(data.data) ? data.data : []).map((model: { id?: string }) => model.id)
  const available = models.filter((model: unknown): model is string => typeof model === 'string')
  const requested = preferred || process.env.FORMA_MODEL
  if (requested && !available.includes(requested)) throw new Error('Выбранная модель недоступна этому аккаунту. Укажите доступную модель в настройках подключения.')
  const model = requested || (available.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : available.find((id: string) => /^gpt-/.test(id) && !/image|audio|realtime|transcribe|tts|search/.test(id)))
  if (!model) throw new Error('Аккаунт не предоставил доступную текстовую модель. Проверьте тариф и разрешения ChatGPT.')
  return model
}
export async function connectApiKey(key: string, model?: string): Promise<AuthStatus> {
  if (typeof key !== 'string' || key.trim().length < 20 || key.length > 1024 || /\s/.test(key.trim())) throw new Error('Введите действительный API-ключ OpenAI.')
  if (model && !/^[\w.:-]{1,100}$/.test(model)) throw new Error('Некорректное имя модели.')
  return locked(async () => {
    const selected = await modelFor(key.trim(), 'api-key', model)
    const data = await load()
    data.connection = { provider: 'api-key', apiKey: key.trim(), model: selected }
    delete data.error; pending = undefined
    await save(data)
    return status(data)
  })
}

export async function getAIConnection(signal?: AbortSignal): Promise<AIConnection> {
  return locked(async () => {
    const data = await load()
    const connection = data.connection
    if (!connection) throw new Error('Подключите ChatGPT или API-ключ в настройках, чтобы использовать ИИ.')
    if (connection.provider === 'api-key') return { provider: 'api-key', token: connection.apiKey, model: connection.model }
    try {
      scopesCheck(connection.scopes)
      if (connection.expiresAt < Date.now() + 60_000) {
        if (!connection.refreshToken) throw new Error('Авторизация ChatGPT истекла. Подключите аккаунт заново.')
        const token = await jsonRequest(`${ISSUER}/api/accounts/oauth/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal,
          body: new URLSearchParams({ grant_type: 'refresh_token', client_id: connection.clientId, refresh_token: connection.refreshToken, resource: RESOURCE }),
        }) as TokenResponse
        const fields = tokenFields(token, connection.scopes)
        if (!token.refresh_token) throw new Error('OpenAI не вернул обновлённую сессию. Подключите аккаунт заново.')
        if (token.id_token) {
          const identity = await verifyIdentity(token.id_token, connection.clientId)
          if (identity.sub !== connection.subject) throw new Error('Обновлённая сессия принадлежит другому аккаунту.')
          connection.idToken = token.id_token
        }
        Object.assign(connection, fields, { refreshToken: token.refresh_token })
        await save(data) // Persist rotating tokens before any subsequent request can use them.
      }
      if (!connection.model) {
        connection.model = await modelFor(connection.accessToken, 'chatgpt', undefined, signal)
      }
      delete data.error
      await save(data)
      return { provider: 'chatgpt', token: connection.accessToken, model: connection.model }
    } catch (error) {
      if (error instanceof ProviderError && (error.code === 'invalid_grant' || error.statusCode === 401)) delete data.connection
      data.error = error instanceof Error ? error.message : 'Подключение ИИ недоступно.'
      await save(data)
      throw error
    }
  })
}

export async function disconnectAuth(): Promise<void> {
  return locked(async () => {
    const data = await load(); const connection = data.connection
    pending = undefined
    delete data.error
    if (connection?.provider === 'chatgpt' && connection.refreshToken) {
      try {
        const config = await discovery()
        if (!config.revocation_endpoint) throw new Error()
        const response = await fetch(config.revocation_endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: connection.refreshToken, token_type_hint: 'refresh_token', client_id: connection.clientId }) })
        if (!response.ok) throw new Error()
      } catch { data.error = 'Локальное подключение удалено. Отзыв доступа на сервере не подтверждён; при необходимости отключите Forma CMS в настройках ChatGPT.' }
    }
    delete data.connection
    await save(data) // Keep host/client/verified subject; discard all tokens.
  })
}
