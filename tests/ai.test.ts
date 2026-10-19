import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { connectApiKey } from '../server/auth.js'
import { readResponseStream, runAgent } from '../server/ai.js'
import type { SiteFiles, Attachment } from '../shared/types.js'

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
function stream(output: unknown[], options: { chunks?: number; completed?: boolean; failure?: boolean } = {}) {
  const events = output.map(item => ({ type: 'response.output_item.done', item }))
  if (options.completed !== false) events.push(options.failure ? { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } } as never : { type: 'response.completed', response: { status: 'completed', output } } as never)
  const bytes = new TextEncoder().encode(events.map(event => `event: ignored\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(''))
  let offset = 0
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) return controller.close()
    const end = Math.min(bytes.length, offset + (options.chunks || bytes.length))
    controller.enqueue(bytes.slice(offset, end)); offset = end
  } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
const final = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const call = (name: string, args: unknown, id = 'call-1') => ({ type: 'function_call', namespace: 'forma', name, call_id: id, arguments: JSON.stringify(args) })
const seed = (): SiteFiles => ({ 'content.json': JSON.stringify({ name: 'Студия', title: 'Наш сайт', description: 'Описание', accent: '#00aa99', email: 'owner@example.test', phone: '+7', sections: [{ id: 'home', type: 'hero', title: 'Привет' }] }), 'styles.css': 'body { color: #111; }', 'script.js': '' })
async function setup(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'forma-ai-'))
  const originalFetch = globalThis.fetch; const originalDirectory = process.env.FORMA_DATA_DIR
  process.env.FORMA_DATA_DIR = directory
  t.after(async () => { globalThis.fetch = originalFetch; if (originalDirectory) process.env.FORMA_DATA_DIR = originalDirectory; else delete process.env.FORMA_DATA_DIR; await rm(directory, { recursive: true, force: true }) })
  globalThis.fetch = (async () => json({ data: [{ id: 'test-model' }] })) as typeof fetch
  await connectApiKey('sk-test-key-long-enough-for-validation', 'test-model')
  return directory
}
const run = (files: SiteFiles, additions: Record<string, unknown> = {}) => runAgent({ message: 'Добавь функцию', history: [], attachments: [], files, integrations: [], signal: new AbortController().signal, onStage: () => {}, ...additions })

test('SSE parser survives byte/chunk boundaries and requires terminal success', async () => {
  const output = [final('Готово — форма добавлена')]
  assert.deepEqual(await readResponseStream(stream(output, { chunks: 1 })), output)
  await assert.rejects(readResponseStream(stream(output, { chunks: 3, completed: false })), /прервалось/)
  await assert.rejects(readResponseStream(stream(output, { failure: true })), /Лимит/)
  await assert.rejects(readResponseStream(json({ output })), /поток/)
})

test('real provider tool loop proposes working source edits without mutating the original', async t => {
  await setup(t)
  const files = seed()
  const before = structuredClone(files)
  let request = 0
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    const body = JSON.parse(String(init?.body))
    assert.equal(body.stream, true); assert.equal(body.store, false)
    assert.equal(body.tools[0].type, 'namespace')
    assert.equal(body.previous_response_id, undefined)
    assert.equal(body.max_output_tokens, undefined)
    assert.equal(body.input.some((item: { role?: string }) => item.role === 'system'), false)
    request++
    if (request === 1) return stream([call('read_file', { path: 'content.json' })])
    if (request === 2) {
      assert.equal(JSON.parse(body.input.at(-1).output).content, before['content.json'])
      const document = JSON.parse(before['content.json'])
      document.sections.push({ id: 'contact', type: 'form', title: 'Заявка', fields: [{ name: 'email', label: 'Почта', type: 'email', required: true }] })
      return stream([call('forma.write_file', { path: 'content.json', content: JSON.stringify(document) }, 'call-2'), call('write_file', { path: 'script.js', content: 'document.querySelector("#home")?.setAttribute("data-enhanced", "true");' }, 'call-3')])
    }
    return stream([final('Форма и интерактивность добавлены в черновик.')])
  }) as typeof fetch
  const result = await run(files)
  assert.equal(request, 3)
  assert.deepEqual(files, before)
  assert.equal(JSON.parse(result.files['content.json']).sections[1].type, 'form')
  assert.match(result.files['script.js'], /data-enhanced/)
})

test('unknown tools, traversal, invalid JS and public secrets are rejected with repair feedback', async t => {
  await setup(t)
  const files = seed()
  let request = 0
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    request++
    if (request === 1) return stream([
      call('write_file', { path: '../../.credentials', content: 'x' }, 'traversal'),
      call('write_file', { path: 'script.js', content: 'function {' }, 'syntax'),
      call('write_file', { path: 'script.js', content: 'const apiKey = "sk-secret-long-enough-to-detect";' }, 'secret'),
      call('execute_shell', { command: 'echo dangerous' }, 'unknown'),
    ])
    const body = JSON.parse(String(init?.body))
    const outputs = body.input.filter((item: { type: string }) => item.type === 'function_call_output')
    assert.equal(outputs.length, 4)
    assert.ok(outputs.every((item: { output: string }) => typeof JSON.parse(item.output).error === 'string'))
    return stream([final('Для этой задачи нужны поддерживаемые исходники.')])
  }) as typeof fetch
  const result = await run(files)
  assert.deepEqual(result.files, files)
})

test('integration proposals cannot enable delivery or carry secret state to another destination', async t => {
  await setup(t)
  let request = 0
  globalThis.fetch = (async () => ++request === 1 ? stream([
    call('configure_integration', { id: 'crm', type: 'webhook', name: 'CRM', endpoint: 'https://new.example.test/hook', script: null }),
    call('configure_integration', { id: 'analytics', type: 'script', name: 'Аналитика', endpoint: null, script: 'console.info("Analytics integration placeholder supplied by owner");' }, 'script'),
  ]) : stream([final('Интеграции подготовлены. Включите их в настройках после проверки.')])) as typeof fetch
  const original = [{ id: 'crm', type: 'webhook' as const, name: 'CRM', endpoint: 'https://old.example.test/hook', enabled: true, secretConfigured: true }]
  const result = await run(seed(), { integrations: original })
  assert.equal(result.integrations[0].enabled, false)
  assert.equal(result.integrations[0].secretConfigured, undefined)
  assert.equal(result.integrations[1].enabled, false)
  assert.equal(original[0].enabled, true)
})

test('selected attachments supply text pages and image/PDF bytes without fetching arbitrary URLs', async t => {
  const directory = await setup(t)
  await mkdir(path.join(directory, 'attachments'))
  await writeFile(path.join(directory, 'attachments', 'image-1'), Buffer.from('test-image-bytes'))
  await writeFile(path.join(directory, 'attachments', 'pdf-1'), Buffer.from('%PDF test'))
  await writeFile(path.join(directory, 'attachments', 'text-1'), 'Услуга,Цена\nУборка,1000')
  const attachments: Attachment[] = [
    { id: 'text-1', name: 'Цены.csv', mime: 'text/csv', size: 5, url: '/assets/text-1', text: 'Услуга,Цена\nУборка,1000', createdAt: new Date().toISOString() },
    { id: 'image-1', name: 'Фото.png', mime: 'image/png', size: 16, url: '/assets/image-1', createdAt: new Date().toISOString() },
    { id: 'pdf-1', name: 'Брендбук.pdf', mime: 'application/pdf', size: 9, url: '/assets/pdf-1', createdAt: new Date().toISOString() },
  ]
  let request = 0
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body))
    if (++request === 1) {
      const content = body.input.at(-1).content
      assert.match(content.find((part: { type: string }) => part.type === 'input_image').image_url, /^data:image\/png;base64,/)
      assert.match(content.find((part: { type: string }) => part.type === 'input_file').file_data, /^data:application\/pdf;base64,/)
      return stream([call('get_attachment', { id: 'text-1', offset: 0 })])
    }
    assert.match(JSON.parse(body.input.at(-1).output).text, /1000/)
    return stream([final('Материалы прочитаны.')])
  }) as typeof fetch
  assert.equal((await run(seed(), { attachments })).message, 'Материалы прочитаны.')
})

test('cancelled runs and endless tool loops cannot commit a proposal', async t => {
  await setup(t)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(run(seed(), { signal: controller.signal }), { name: 'AbortError' })
  let requests = 0
  globalThis.fetch = (async () => { requests++; return stream([call('list_files', {}, `call-${requests}`)]) }) as typeof fetch
  await assert.rejects(run(seed()), /лимита шагов/)
  assert.equal(requests, 12)
})
