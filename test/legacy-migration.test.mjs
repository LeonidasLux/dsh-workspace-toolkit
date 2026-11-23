// 旧版插件（@local/workspace-model-panel）数据迁移测试。
// 场景：profile 里只有旧的 plugin-data/workspace-model-panel.json，
// 新版（@ylhsweet/dsh-workspace-toolkit）第一次启动应把数据读进来、写出新文件，且旧文件保留。
import { pathToFileURL, fileURLToPath } from 'node:url'
import { rm, mkdir, readFile, writeFile } from 'node:fs/promises'

const PLUGIN = fileURLToPath(new URL('../index.js', import.meta.url))
const PROFILE_DIR = '/tmp/wtk-legacy-test-profile'
process.env.DSH_PROFILE_DIR = PROFILE_DIR

await rm(PROFILE_DIR, { recursive: true, force: true })
await mkdir(PROFILE_DIR + '/plugin-data', { recursive: true })
const legacyRecord = {
  pinned: true,
  note: '旧数据',
  color: '#4f8cff',
  collapsed: false,
  model: { provider: 'co-claw', model: 'co-claw' },
  updatedAt: '2026-11-11T00:00:00.000Z',
}
await writeFile(
  PROFILE_DIR + '/plugin-data/workspace-model-panel.json',
  JSON.stringify({
    version: 2,
    workspaces: { 'legacy-ws': legacyRecord },
    global: { settings: { showSidebarEntry: false }, pinnedOrder: ['legacy-ws'], order: [] },
  }, null, 2),
  'utf8',
)

const mod = await import(pathToFileURL(PLUGIN).href)

const routes = new Map()
const workspaces = [
  { id: 'legacy-ws', path: '/home/me/legacy', title: 'Legacy', createdAt: 'c', updatedAt: 'u', sessionIds: [] },
]
const warnings = []
const ctx = {
  logger: { info() {}, warn(...args) { warnings.push(args) }, error() {} },
  effect(fn) { fn() },
  on() {},
  get(name) {
    if (name === 'workspaceController') {
      return {
        async *follow(signal) {
          yield { type: 'baseline', value: { workspaceIds: ['legacy-ws'] } }
          await new Promise((resolve) => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        },
      }
    }
    return null
  },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  workspaceRegistry: {
    list: () => workspaces.slice(),
    resolveByPath: (path) => workspaces.find((workspace) => workspace.path === path),
    async insertBefore(id, beforeId) {
      const from = workspaces.findIndex((workspace) => workspace.id === id)
      const moved = workspaces.splice(from, 1)[0]
      const anchor = beforeId === undefined ? workspaces.length : workspaces.findIndex((workspace) => workspace.id === beforeId)
      workspaces.splice(anchor, 0, moved)
      return workspaces.map((workspace) => workspace.id)
    },
  },
  sessionQuery: { listSessions: async () => [], observeSession: async () => ({ cursor: 0, inheritedEventCount: 0, events: [] }) },
  llm: { listProviders: async () => [], listModels: async () => [] },
}

mod.apply(ctx, {})

function getJson(path) {
  const route = routes.get(path)
  if (!route) throw new Error('route missing: ' + path)
  return new Promise((resolve, reject) => {
    const req = { method: 'GET', url: path, [Symbol.asyncIterator]: async function* () {} }
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { try { resolve({ status: this.status, json: JSON.parse(body) }) } catch (error) { reject(error) } },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

const assert = (cond, message) => {
  if (!cond) { console.error('FAIL:', message); process.exitCode = 1 } else { console.log('ok  -', message) }
}

const snap = await getJson('/workspace-toolkit/snapshot')
assert(snap.status === 200 && snap.json.ok, 'snapshot served after legacy migration')
const ws = snap.json.workspaces.find((workspace) => workspace.workspaceId === 'legacy-ws')
assert(Boolean(ws), 'legacy workspace present in snapshot')
assert(ws.note === '旧数据', 'legacy note migrated')
assert(ws.model && ws.model.provider === 'co-claw', 'legacy model override migrated')
assert(ws.pinned === true, 'legacy pin migrated')
assert(snap.json.settings.showSidebarEntry === false, 'legacy global settings migrated')

const migrated = JSON.parse(await readFile(PROFILE_DIR + '/plugin-data/workspace-toolkit.json', 'utf8'))
assert(migrated.version === 2, 'new store file written with version 2')
assert(migrated.workspaces['legacy-ws'].note === '旧数据', 'new store file carries legacy record')
assert(migrated.global.pinnedOrder.join(',') === 'legacy-ws', 'new store file carries legacy pinned order')

const legacyStillThere = JSON.parse(await readFile(PROFILE_DIR + '/plugin-data/workspace-model-panel.json', 'utf8'))
assert(legacyStillThere.version === 2, 'legacy file is kept as-is (no destructive migration)')

if (process.exitCode) console.error('RESULT: FAILED')
else console.log('RESULT: ALL PASSED')
