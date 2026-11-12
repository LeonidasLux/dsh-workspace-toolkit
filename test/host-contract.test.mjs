// Host-half contract test for @local/workspace-toolkit (no Harness boot).
//
// 覆盖：路由注册、snapshot 形状、meta 校验（note/color/model）、置顶经
// workspaceRegistry.insertBefore 改写原生顺序、settings 开关、按会话归属的 Token 汇总、
// client-report 往返、agent/created 六条跳过规则 + 正常套用、落盘内容。
import { pathToFileURL, fileURLToPath } from 'node:url'
import { rm, mkdir, readFile } from 'node:fs/promises'

const PLUGIN = fileURLToPath(new URL('../index.js', import.meta.url))
const PROFILE_DIR = '/tmp/wtk-test-profile'
process.env.DSH_PROFILE_DIR = PROFILE_DIR

await rm(PROFILE_DIR, { recursive: true, force: true })
await mkdir(PROFILE_DIR, { recursive: true })

const mod = await import(pathToFileURL(PLUGIN).href)

// ---------------------------------------------------------------- mocks
const routes = new Map()
const handlers = []
const effects = []
const warnings = []
const insertBeforeCalls = []

const workspaces = [
  { id: 'ws-a', path: '/home/me/proj-a', title: 'Project A', createdAt: 'c', updatedAt: 'u', sessionIds: ['s1', 's2'] },
  { id: 'ws-b', path: '/home/me/proj-b', title: 'Project B', createdAt: 'c', updatedAt: 'u', sessionIds: [] },
  { id: 'ws-c', path: '/home/me/proj-c', title: 'Project C', createdAt: 'c', updatedAt: 'u', sessionIds: [] },
]

const sessionTotals = {
  s1: { inputTokens: 100, outputTokens: 10, totalTokens: 200, cacheReadTokens: 90, cacheWriteTokens: 0, reasoningTokens: 0 },
  s2: { inputTokens: 300, outputTokens: 30, totalTokens: 400, cacheReadTokens: 70, cacheWriteTokens: 0, reasoningTokens: 0 },
}

const followFrames = []
let followWaiter = null
const workspaceController = {
  async *follow(signal) {
    yield { type: 'baseline', value: { workspaceIds: workspaces.map((workspace) => workspace.id) } }
    while (!signal.aborted) {
      if (followFrames.length === 0) {
        await new Promise((resolve) => { followWaiter = resolve })
        continue
      }
      yield followFrames.shift()
    }
  },
}
function pushFollowFrame(frame) {
  followFrames.push(frame)
  if (followWaiter) {
    const resolve = followWaiter
    followWaiter = null
    resolve()
  }
}

// ---- 自定义模型供应商：configEditor + credentials 的宿主 mocks
// 真实 configEditor.entries() 返回 Loader entry（{options:{id,name,config},fiber}），这里用同样的形状
const piAiEntry = { options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }, fiber: {} }
const configEditorState = { available: true, writes: [] }
let piAiConfig = {
  providers: {
    'co-claw': {
      displayName: 'Co-Claw (公司 MaaS)',
      api: 'openai-completions',
      baseURL: 'https://maas.example.com/model-cop/co-claw/v1',
      apiKeyEnv: 'CO_CLAW_API_KEY',
      headers: { 'X-UAC-APP-ID': '1234567890' },
      models: [{ id: 'co-claw', name: 'co-claw', contextWindow: 256000, maxTokens: 16384, input: ['text'] }],
    },
  },
}
const configEditor = {
  entries() { return configEditorState.available ? [piAiEntry, { options: { id: 'session-log-deepseek', name: '@deepseek-ai/dsh-session-log-deepseek' }, fiber: {} }] : [] },
  configuration() { return [{ entry: piAiEntry, inherited: {}, override: piAiConfig }] },
  async edit(entry, change) {
    configEditorState.writes.push(JSON.parse(JSON.stringify({ entryId: entry.options.id, config: piAiConfig })))
    piAiConfig = change(JSON.parse(JSON.stringify(piAiConfig)), {})
  },
}
const credentialStore = new Map([['CO_CLAW_API_KEY', 'secret-key-value']])
const credentials = {
  describe: (ref) => ({ configured: credentialStore.has(ref) }),
  set: async (ref, value) => { credentialStore.set(ref, value) },
  resolve: async (ref) => (credentialStore.has(ref) ? { value: credentialStore.get(ref) } : undefined),
}

const ctx = {
  logger: { info() {}, warn(...args) { warnings.push(args) }, error() {} },
  effect(fn) { effects.push(fn()) },
  on(event, fn) { handlers.push({ event, fn }) },
  get(name) {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
    if (name === 'workspaceController') return workspaceController
    if (name === 'configEditor') return configEditorState.available ? configEditor : null
    if (name === 'credentials') return credentials
    return null
  },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  workspaceRegistry: {
    list: () => workspaces.slice(),
    resolveByPath: (path) => workspaces.find((workspace) => workspace.path === path),
    // DOM insertBefore 语义：无 anchor 追加到末尾
    async insertBefore(id, beforeId) {
      insertBeforeCalls.push([id, beforeId])
      const from = workspaces.findIndex((workspace) => workspace.id === id)
      if (from < 0) throw new Error('unknown workspace ' + id)
      const moved = workspaces.splice(from, 1)[0]
      const anchor = beforeId === undefined ? workspaces.length : workspaces.findIndex((workspace) => workspace.id === beforeId)
      if (anchor < 0) throw new Error('unknown anchor ' + beforeId)
      workspaces.splice(anchor, 0, moved)
      return workspaces.map((workspace) => workspace.id)
    },
  },
  sessionQuery: {
    listSessions: async () => [
      { header: { id: 's1', cwd: '/home/me/proj-a' } },
      { header: { id: 's2', cwd: '/home/me/proj-a' } },
    ],
    observeSession: async (sessionId) => ({
      cursor: 10,
      inheritedEventCount: 0,
      events: [
        { type: 'user/message', seq: 1, data: {} },
        { type: 'assistant/message', seq: 2, data: { usage: sessionTotals[sessionId] } },
      ],
    }),
  },
  llm: {
    listProviders: async () => [{ id: 'deepseek-official', name: 'DeepSeek' }, { id: 'acme', name: 'ACME' }],
    listModels: async (provider) => (provider === 'acme'
      ? [{ id: 'acme-large', name: 'ACME Large' }]
      : [{ id: 'deepseek-flash', name: 'DeepSeek-Flash' }, { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }]),
  },
}

mod.apply(ctx, {})

const assert = (cond, message) => {
  if (!cond) { console.error('FAIL:', message); process.exitCode = 1 } else { console.log('ok  -', message) }
}

// ---------------------------------------------------------------- helpers
function jsonBody(value) {
  const text = JSON.stringify(value)
  return { method: 'POST', [Symbol.asyncIterator]: async function* () { yield Buffer.from(text, 'utf8') } }
}
function getReq(query = '') { return { method: 'GET', url: '/workspace-toolkit/snapshot' + query, [Symbol.asyncIterator]: async function* () {} } }
async function call(path, req) {
  const route = routes.get(path)
  if (!route) throw new Error('missing route ' + path)
  const result = { status: 0, headers: {}, body: null }
  const res = { writeHead(status, headers) { result.status = status; result.headers = headers || {} }, end(body) { result.body = body } }
  await route.handler(req, res)
  for (let i = 0; i < 100 && result.body === null; i += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  result.json = result.body ? JSON.parse(result.body) : null
  return result
}
const snapshot = async () => (await call('/workspace-toolkit/snapshot', getReq())).json
const findWs = (snap, id) => snap.workspaces.find((workspace) => workspace.workspaceId === id)

// 1. routes -------------------------------------------------------------
assert(mod.name === 'workspace-toolkit', 'plugin name exported')
for (const path of ['/workspace-toolkit/snapshot', '/workspace-toolkit/meta', '/workspace-toolkit/settings', '/workspace-toolkit/ping', '/workspace-toolkit/client-report', '/workspace-toolkit/providers', '/workspace-toolkit/providers/test']) {
  assert(routes.has(path), 'route registered: ' + path)
}
assert(!routes.has('/workspace-toolkit/order'), 'legacy /order route removed (pinning owns native order)')

// 2. snapshot baseline --------------------------------------------------
const base = await snapshot()
assert(base.status === undefined && base.ok === true && base.version === 2, 'GET /snapshot returns ok, version 2')
assert(base.workspaces.length === 3, 'snapshot lists 3 workspaces')
assert(base.workspaces.every((workspace) => workspace.model === null), 'workspace model defaults to null (follow current)')
assert(base.defaultModel.provider === 'deepseek-official', 'snapshot exposes default model')
assert(base.models.providers.length === 2 && base.models.providers[1].models[0].id === 'acme-large', 'snapshot exposes provider/model catalog')
assert(base.settings.showSidebarEntry === true, 'sidebar entry shown by default')

// 3. per-workspace token usage -----------------------------------------
const wsAUsage = findWs(base, 'ws-a').usage
assert(wsAUsage.totalTokens === 600 && wsAUsage.inputTokens === 400 && wsAUsage.sessions === 2, 'token usage aggregated per workspace from session logs')
assert(findWs(base, 'ws-a').sessionCount === 2, 'session count exposed per workspace')
assert(findWs(base, 'ws-b').usage.totalTokens === 0, 'workspace without sessions has zero usage')

// 4. meta: model / note / color validation ------------------------------
const setModel = await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-a', patch: { model: { provider: 'acme', model: 'acme-large' }, note: '备注测试', color: '#3b82f6' } }))
assert(setModel.status === 200 && setModel.json.ok === true, 'POST /meta single accepted')
const wsASet = findWs(setModel.json, 'ws-a')
assert(wsASet.model.model === 'acme-large' && wsASet.note === '备注测试' && wsASet.color === '#3b82f6', 'model + note + color persisted and returned in response snapshot')

await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-b', patch: { color: 'red', note: 'x'.repeat(300) + '\nline2' } }))
const wsB = findWs(await snapshot(), 'ws-b')
assert(wsB.color === '' && wsB.note.length === 120 && !wsB.note.includes('\n'), 'unsafe color rejected, note clipped to one line')

await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-b', patch: { color: 'rgb(59, 130, 246)' } }))
assert(findWs(await snapshot(), 'ws-b').color === 'rgb(59, 130, 246)', 'rgb() color accepted')
await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-b', patch: { model: null } }))
assert(findWs(await snapshot(), 'ws-b').model === null, 'model null clears override (follow current)')

const unknown = await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'nope', patch: { note: 'x' } }))
assert(unknown.json.ok === false, 'unknown workspaceId rejected')

// 5. pinning rewrites the native registry order -------------------------
insertBeforeCalls.length = 0
const pinB = await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-b', patch: { pinned: true } }))
assert(pinB.json.ok === true, 'POST /meta pinned accepted')
assert(pinB.json.workspaces.map((workspace) => workspace.workspaceId).join(',') === 'ws-b,ws-a,ws-c', 'pinned workspace moved to the front of the native order')
assert(insertBeforeCalls.length === 1 && insertBeforeCalls[0][0] === 'ws-b' && insertBeforeCalls[0][1] === 'ws-a', 'pinning goes through workspaceRegistry.insertBefore (one durable write)')

const pinA = await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-a', patch: { pinned: true } }))
assert(pinA.json.workspaces.map((workspace) => workspace.workspaceId).join(',') === 'ws-a,ws-b,ws-c', 'second pin lands above the first, keeps pinned block contiguous')
assert(pinA.json.pinnedOrder.join(',') === 'ws-a,ws-b', 'pinnedOrder exposes the pinned block order')

const unpinB = await call('/workspace-toolkit/meta', jsonBody({ workspaceId: 'ws-b', patch: { pinned: false } }))
assert(unpinB.json.pinnedOrder.join(',') === 'ws-a', 'unpin removes only that workspace from the pinned block')
assert(unpinB.json.workspaces[0].workspaceId === 'ws-a' && unpinB.json.workspaces[1].workspaceId === 'ws-b', 'unpinned workspace stays right after the pinned block')
assert(findWs(unpinB.json, 'ws-b').pinned === false, 'pinned flag cleared')

// 6. bulk meta ----------------------------------------------------------
const bulk = await call('/workspace-toolkit/meta', jsonBody({ items: [{ workspaceId: 'ws-a', patch: { note: 'A' } }, { workspaceId: 'ws-c', patch: { note: 'C' } }] }))
assert(bulk.json.ok === true && findWs(bulk.json, 'ws-a').note === 'A' && findWs(bulk.json, 'ws-c').note === 'C', 'POST /meta bulk accepted and returns updated snapshot')

// 7. settings / ping / client-report ------------------------------------
await call('/workspace-toolkit/settings', jsonBody({ patch: { showSidebarEntry: false } }))
assert((await snapshot()).settings.showSidebarEntry === false, 'settings.showSidebarEntry persisted')
await call('/workspace-toolkit/settings', jsonBody({ patch: { showSidebarEntry: true } }))

const ping = await call('/workspace-toolkit/ping', getReq())
assert(ping.json.ok === true && ping.json.workspaceCount === 3 && ping.json.metaCount >= 1, 'GET /ping diagnostics ok')
assert(ping.json.store === 'file', 'fallback file store used without storage service')

await call('/workspace-toolkit/client-report', jsonBody({ applied: true, href: 'x', errors: [{ label: 'l', message: 'm' }] }))
const report = (await call('/workspace-toolkit/client-report', getReq())).json
assert(report.report.applied === true && report.report.errors.length === 1, 'client-report round trip')

// 8. agent/created applies workspace model only to fresh startup sessions
const created = handlers.filter((handler) => handler.event === 'agent/created')
assert(created.length === 1, 'one agent/created listener registered')
const listener = created[0].fn

async function emit(source, opts = {}) {
  const selected = []
  const agent = {
    session: {
      header: { cwd: opts.cwd ?? '/home/me/proj-a', origin: opts.origin, parentSession: opts.parentSession },
      requestHeader: () => opts.header,
      ownEvents: () => opts.events ?? [],
    },
    model: { current: () => opts.current, select: (value) => selected.push(value) },
  }
  await listener({ agent, source })
  return selected
}

const fresh = await emit('startup', { header: undefined, events: [] })
assert(fresh.length === 1 && fresh[0].provider === 'acme' && fresh[0].model === 'acme-large', 'startup session inherits workspace model')
const resumed = await emit('resume', { header: undefined, events: [] })
assert(resumed.length === 1 && resumed[0].provider === 'acme', 'resumed session without its own choice follows the workspace model')
const resumedPicked = await emit('resume', { header: undefined, events: [{ type: 'model/selection' }] })
assert(resumedPicked.length === 0, 'resumed session that already picked a model is left alone')
const resumedStarted = await emit('resume', { header: { config: { provider: 'x', model: 'y' } }, events: [] })
assert(resumedStarted.length === 0, 'resumed session with a live request header is left alone')
const cleared = await emit('clear', {})
assert(cleared.length === 0, 'clear/compact keeps existing choice')
const userPicked = await emit('startup', { header: undefined, events: [{ type: 'model/selection' }] })
assert(userPicked.length === 0, 'explicit user selection is not overridden')
const withHeader = await emit('startup', { header: { config: { provider: 'x', model: 'y' } } })
assert(withHeader.length === 0, 'session that already recorded a request header is untouched')
const noOverride = await emit('startup', { cwd: '/home/me/proj-b' })
assert(noOverride.length === 0, 'workspace without override leaves the model alone (default = current model)')
const outside = await emit('startup', { cwd: '/tmp/elsewhere' })
assert(outside.length === 0, 'session outside any workspace is untouched')
const subagent = await emit('startup', { cwd: '/home/me/proj-a', origin: 'subagent' })
assert(subagent.length === 0, 'subagent session inherits its parent model, not the workspace model')
const child = await emit('startup', { cwd: '/home/me/proj-a', parentSession: 'parent-1' })
assert(child.length === 0, 'child session with parentSession is untouched')
const noModelApi = { session: { header: { cwd: '/home/me/proj-a' } } }
await listener({ agent: noModelApi, source: 'startup' })
assert(true, 'agent without model api does not throw')

// 9. persistence file contents -----------------------------------------
const raw = JSON.parse(await readFile(PROFILE_DIR + '/plugin-data/workspace-toolkit.json', 'utf8'))
assert(raw.version === 2, 'store version recorded')
assert(raw.workspaces['ws-a'].model.model === 'acme-large', 'model stored on disk')
assert(raw.workspaces['ws-a'].note === 'A', 'note stored on disk')
assert(Array.isArray(raw.global.pinnedOrder) && raw.global.pinnedOrder.join(',') === 'ws-a', 'pinnedOrder stored on disk')
assert(raw.global.settings.showSidebarEntry === true, 'global settings stored on disk')

// 10. usage cache survives repeated snapshots --------------------------
const cachedSnap = await snapshot()
assert(cachedSnap.workspaces.find((workspace) => workspace.workspaceId === 'ws-a').usage.totalTokens === 600, 'usage stable across repeated snapshots')

// 10b. 新建工作区会被 prepend 到队首；置顶块必须回到最前面 ---------------
const WS_NEW1 = { id: 'ws-new1', path: '/home/me/proj-new1', title: 'Project New 1', createdAt: 'c', updatedAt: 'u', sessionIds: [] }
const WS_NEW2 = { id: 'ws-new2', path: '/home/me/proj-new2', title: 'Project New 2', createdAt: 'c', updatedAt: 'u', sessionIds: [] }

insertBeforeCalls.length = 0
workspaces.unshift(WS_NEW1)
pushFollowFrame({ type: 'order', workspaceIds: workspaces.map((workspace) => workspace.id) })
await new Promise((resolve) => setTimeout(resolve, 450))
assert(workspaces.map((workspace) => workspace.id).join(',') === 'ws-a,ws-new1,ws-b,ws-c', 'a workspace/order event heals the pinned block after a new workspace is prepended')

insertBeforeCalls.length = 0
workspaces.unshift(WS_NEW2)
const healed = await snapshot()
assert(healed.workspaces.map((workspace) => workspace.workspaceId).join(',') === 'ws-a,ws-new2,ws-new1,ws-b,ws-c', 'a snapshot heals the pinned block without waiting for an event')
assert(insertBeforeCalls.length >= 1, 'healing goes through workspaceRegistry.insertBefore')

// 10c. 自定义模型供应商：快照 + 读取 + 保存 + 删除 + 连通性测试 --------
const providersSnap = (await snapshot()).customProviders
assert(providersSnap && providersSnap.available === true, 'customProviders available in snapshot')
assert(providersSnap.entryId === 'llm-pi-ai', 'customProviders targets the pi-ai entry')
const seeded = providersSnap.providers.find((provider) => provider.route === 'co-claw')
assert(Boolean(seeded), 'seeded co-claw provider listed')
assert(seeded.headers['X-UAC-APP-ID'] === '1234567890', 'provider headers read back')
assert(seeded.models[0].contextWindow === 256000, 'provider model fields read back')
assert(seeded.keyConfigured === true && seeded.apiKeyEnv === 'CO_CLAW_API_KEY', 'provider key reference reported configured')
assert(!JSON.stringify(providersSnap).includes('secret-key-value'), 'provider snapshot never leaks the key value')

const providersGet = (await call('/workspace-toolkit/providers', getReq())).json
assert(providersGet.available === true && providersGet.providers.length === 1, 'GET /providers lists one provider')

configEditorState.writes.length = 0
const saveProviderRes = await call('/workspace-toolkit/providers', jsonBody({
  route: 'acme-custom',
  patch: {
    displayName: 'ACME 自定义',
    api: 'openai-completions',
    baseURL: 'https://acme.example.com/v1',
    apiKey: 'sk-acme-written',
    headers: { 'X-Team': 'aics', 'bad header': 'dropped', 'X-Empty': 7 },
    models: [{ id: 'acme-chat', name: 'ACME Chat', maxTokens: 4096, input: ['text', 'image', 'audio'] }],
  },
}))
assert(saveProviderRes.json.ok === true, 'POST /providers saves a new provider')
assert(configEditorState.writes.length === 1, 'save goes through configEditor.edit once')
assert(credentialStore.get('ACME_CUSTOM_API_KEY') === 'sk-acme-written', 'api key written to the credential store under a derived reference')
const savedConfig = piAiConfig.providers['acme-custom']
assert(savedConfig.apiKeyEnv === 'ACME_CUSTOM_API_KEY', 'derived apiKeyEnv recorded on the provider')
assert(savedConfig.headers['X-Team'] === 'aics' && savedConfig.headers['bad header'] === undefined && savedConfig.headers['X-Empty'] === undefined, 'headers whitelisted and sanitized')
assert(JSON.stringify(savedConfig.models[0].input) === JSON.stringify(['text', 'image']), 'model input types filtered to text/image')
assert(!JSON.stringify(savedConfig).includes('sk-acme-written'), 'plain api key never written into provider config')
const afterSave = saveProviderRes.json.customProviders.providers.find((provider) => provider.route === 'acme-custom')
assert(Boolean(afterSave) && afterSave.keyConfigured === true, 'saved provider returned by the route with key state')

const badRoute = await call('/workspace-toolkit/providers', jsonBody({ route: 'bad route!', patch: {} }))
assert(badRoute.json.ok === false && badRoute.json.error === 'invalid-route', 'invalid route rejected')
const badApi = await call('/workspace-toolkit/providers', jsonBody({ route: 'acme-2', patch: { api: 'not-a-protocol', baseURL: 'ftp://x' } }))
assert(badApi.json.ok === true, 'unsupported api/baseURL values silently dropped instead of failing')
assert(piAiConfig.providers['acme-2'].api === undefined && piAiConfig.providers['acme-2'].baseURL === undefined, 'dropped values are not written')

const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => ({
  ok: true,
  status: 200,
  async text() { return JSON.stringify({ model: 'DeepSeek-V4-Flash-0731', choices: [] }) },
  __url: url,
  __headers: options.headers,
})
const testOk = await call('/workspace-toolkit/providers/test', jsonBody({ route: 'acme-custom' }))
assert(testOk.json.ok === true && testOk.json.status === 200, 'provider test reports HTTP 200')
assert(String(testOk.json.detail).includes('DeepSeek-V4-Flash-0731'), 'provider test surfaces the upstream model name')
assert(testOk.json.url === 'https://acme.example.com/v1/chat/completions', 'provider test posts to /chat/completions')
globalThis.fetch = async () => { throw new Error('ECONNREFUSED 10.0.0.1:443') }
const testFail = await call('/workspace-toolkit/providers/test', jsonBody({ route: 'acme-custom' }))
assert(testFail.json.ok === false && String(testFail.json.error).startsWith('network-error:'), 'provider test reports transport errors')
const testUnknown = await call('/workspace-toolkit/providers/test', jsonBody({ route: 'nope' }))
assert(testUnknown.json.ok === false && testUnknown.json.error === 'unknown-route', 'provider test rejects unknown routes')
globalThis.fetch = originalFetch

const removeRes = await call('/workspace-toolkit/providers', jsonBody({ route: 'acme-custom', patch: { delete: true } }))
assert(removeRes.json.ok === true && removeRes.json.removed === true, 'POST /providers deletes with delete:true')
assert(piAiConfig.providers['acme-custom'] === undefined, 'deleted provider removed from the pi-ai entry config')

configEditorState.available = false
const unavailable = (await call('/workspace-toolkit/providers', getReq())).json
assert(unavailable.available === false && unavailable.providers.length === 0, 'providers unavailable when configEditor is absent')
configEditorState.available = true

// 11. cleanup disposers -------------------------------------------------
for (const dispose of effects) if (typeof dispose === 'function') await dispose()

console.log(process.exitCode ? '\nRESULT: FAILURES' : '\nRESULT: ALL PASSED')
if (warnings.length) console.log('warnings captured:', warnings.length)
