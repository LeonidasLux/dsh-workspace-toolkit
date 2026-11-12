// 工作区工具箱 · Host half
//
// 职责：
//   1. 持久化插件数据：每个工作区的模型覆盖 / 备注 / 名称颜色 / 置顶顺序，
//      以及全局设置（侧边栏入口开关）。优先落在 Harness 的 storage json backend 上，
//      没有该服务时回退到 profile 下的 JSON 文件。
//   2. 新建会话（agent/created，serial 且首请求前 await）时，把所属工作区配置的模型
//      写入该会话的模型选择；仅对「全新、且尚无任何模型选择」的会话生效，
//      因此不会覆盖用户手动选择，也不会影响 resume / clear / compact / 子代理。
//   3. 工作区置顶：通过 workspaceRegistry.insertBefore 改写 Harness 自己的持久化
//      工作区顺序（原生侧边栏就按这个顺序渲染），不自己模拟排序。
//   4. 同源路由给 Web 客户端提供快照：
//        GET  /workspace-toolkit/snapshot[?force=1]  工作区 + 元数据 + 模型目录 + Token 用量
//        POST /workspace-toolkit/meta               修改单个/批量工作区元数据（含置顶）
//        POST /workspace-toolkit/settings           修改全局设置
//        POST /workspace-toolkit/client-report      客户端插槽/装饰失败上报
//        GET  /workspace-toolkit/client-report      读取最近一次上报
//        GET  /workspace-toolkit/ping               诊断信息
//   5. 按工作区汇总 Token 用量：读取会话日志的 assistant/message usage，
//      按 workspaceRegistry 的会话归属累加；live 会话按 cursor 增量缓存。
import { homedir } from 'node:os'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const name = 'workspace-toolkit'

// webServer: 同源 HTTP 路由；其余服务提供工作区 / 会话 / 模型目录
export const inject = ['webServer', 'workspaceRegistry', 'workspaceController', 'sessionQuery', 'llm']

const ROUTE_PREFIX = '/workspace-toolkit'
const STORE_NAME = 'workspace-toolkit'
/** 旧版插件名（workspace-model-panel）留下的数据位置，首次启动时迁移 */
const LEGACY_STORE_NAMES = ['workspace-model-panel']
const STORE_VERSION = 2
const MODEL_CACHE_MS = 300000
/** 单个会话读日志的超时，超时按无用量处理，不阻塞快照 */
const OBSERVE_TIMEOUT_MS = 8000
/** 并发读取会话日志的并发上限 */
const OBSERVE_CONCURRENCY = 4
const SNAPSHOT_VERSION = 2

/** pi-ai 适配器的 Loader entry id（自定义模型供应商都落在它的 config.providers 下） */
const PI_AI_ENTRY_ID = 'llm-pi-ai'
/** 自定义模型供应商允许的协议 */
const PROVIDER_APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])
/** 连通性测试的请求超时 */
const PROVIDER_TEST_TIMEOUT_MS = 20000
/** 自定义请求头名字允许的字符集 */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/

const DEFAULT_SETTINGS = {
  // 左侧边栏是否显示本插件入口
  showSidebarEntry: true,
}

const DEFAULT_GLOBAL = () => ({
  settings: { ...DEFAULT_SETTINGS },
  // 置顶工作区 id 列表（顺序 = 置顶块内的相对顺序）
  pinnedOrder: [],
})

const EMPTY_USAGE = () => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  sessions: 0,
})

// ---------------------------------------------------------------- 小工具

function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0) return ''
  let next = value.trim()
  if (next.length > 1 && (next.endsWith('/') || next.endsWith('\\'))) next = next.slice(0, -1)
  return next
}

function sanitizeModel(value) {
  if (!value || typeof value !== 'object') return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (!provider || !model) return null
  if (provider.length > 120 || model.length > 200) return null
  const reasoningEffort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model }
}

// 颜色只接受可安全内联进自建样式表的值：#hex / rgb() / rgba() / hsl() / hsla() / var(--token)
const COLOR_SAFE = [
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
  /^rgba?\(\s*[0-9.%\s,/]+\)$/,
  /^hsla?\(\s*[0-9.%\s,/a-zA-Z]+\)$/,
  /^var\(--[a-zA-Z0-9-]+\)$/,
]

function sanitizeColor(value) {
  const color = typeof value === 'string' ? value.trim() : ''
  if (!color || color.length > 64) return ''
  for (const pattern of COLOR_SAFE) if (pattern.test(color)) return color
  return ''
}

function sanitizeNote(value) {
  if (typeof value !== 'string') return ''
  // 备注只做单行文本，避免注入换行导致标题布局异常
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120)
}

function sanitizePatch(patch) {
  const out = {}
  if (!patch || typeof patch !== 'object') return out
  if ('model' in patch) out.model = sanitizeModel(patch.model)
  if ('pinned' in patch) out.pinned = Boolean(patch.pinned)
  if ('note' in patch) out.note = sanitizeNote(patch.note)
  if ('color' in patch) out.color = sanitizeColor(patch.color)
  return out
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function readJsonBody(req, limit = 262144) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('invalid JSON body')
  }
}

function profileDataDir() {
  const profileDir = process.env.DSH_PROFILE_DIR
    || join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'web')
  return join(profileDir, 'plugin-data')
}

function loggerOf(ctx) {
  const logger = ctx.logger
  if (logger && typeof logger.warn === 'function') return logger
  return console
}

// ---------------------------------------------------------------- 持久化

function createStore(ctx) {
  const log = loggerOf(ctx)
  let pending = null
  let store = null
  const writeChain = Promise.resolve()

  function normalizeGlobal(value) {
    const global = { ...DEFAULT_GLOBAL(), ...(value && typeof value === 'object' ? value : {}) }
    global.settings = { ...DEFAULT_SETTINGS, ...(global.settings && typeof global.settings === 'object' ? global.settings : {}) }
    global.settings.showSidebarEntry = global.settings.showSidebarEntry !== false
    global.pinnedOrder = Array.isArray(global.pinnedOrder)
      ? global.pinnedOrder.filter((id) => typeof id === 'string' && id.length > 0)
      : []
    return global
  }

  async function open() {
    // 1) 优先使用 Harness 的 storage json backend：<profile data>/<name>.json 之类的受管位置
    try {
      const storage = ctx.get('storage')
      const backend = storage && storage.backend && storage.backend.get('json')
      if (backend && backend.kv) {
        const unit = await backend.kv.open({
          name: STORE_NAME,
          version: STORE_VERSION,
          layout: 'single',
          tables: ['workspaces'],
          hasGlobal: true,
        })
        const loaded = await unit.loadAll()
        const records = loaded.tables && loaded.tables.workspaces ? loaded.tables.workspaces : {}
        const empty = Object.keys(records).length === 0 && !loaded.global
        if (!empty) return { kind: 'storage', unit, records: { ...records }, global: normalizeGlobal(loaded.global) }
        // 旧版插件（workspace-model-panel）的受管数据：读出来搬到新 unit
        for (const legacyName of LEGACY_STORE_NAMES) {
          try {
            const legacyUnit = await backend.kv.open({
              name: legacyName,
              version: STORE_VERSION,
              layout: 'single',
              tables: ['workspaces'],
              hasGlobal: true,
            })
            const legacyLoaded = await legacyUnit.loadAll()
            const legacyRecords = legacyLoaded.tables && legacyLoaded.tables.workspaces ? legacyLoaded.tables.workspaces : {}
            const legacyGlobal = normalizeGlobal(legacyLoaded.global)
            if (Object.keys(legacyRecords).length === 0 && legacyGlobal.pinnedOrder.length === 0) {
              await legacyUnit.close()
              continue
            }
            for (const [id, record] of Object.entries(legacyRecords)) await unit.putRecord('workspaces', id, record)
            await unit.setGlobal(legacyGlobal)
            await legacyUnit.close()
            log.info('[workspace-toolkit] migrated legacy storage unit:', legacyName)
            return { kind: 'storage', unit, records: { ...legacyRecords }, global: legacyGlobal }
          } catch (error) {
            log.warn('[workspace-toolkit] legacy storage migration skipped:', legacyName, error)
          }
        }
        return { kind: 'storage', unit, records: { ...records }, global: normalizeGlobal(loaded.global) }
      }
    } catch (error) {
      log.warn('[workspace-toolkit] storage backend unavailable, falling back to file store:', error)
    }

    // 2) 回退：profile 目录下的 JSON 文件（原子替换写入）
    const file = join(profileDataDir(), STORE_NAME + '.json')
    let parsed = null
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      parsed = null
    }
    let migratedFrom = null
    if (!parsed) {
      for (const legacyName of LEGACY_STORE_NAMES) {
        try {
          parsed = JSON.parse(await readFile(join(profileDataDir(), legacyName + '.json'), 'utf8'))
          migratedFrom = legacyName
          break
        } catch {
          parsed = null
        }
      }
    }
    const records = parsed && parsed.workspaces && typeof parsed.workspaces === 'object' ? parsed.workspaces : {}
    return {
      kind: 'file',
      file,
      migratedFrom,
      records: { ...records },
      global: normalizeGlobal(parsed && parsed.global),
    }
  }

  async function ensure() {
    if (store) return store
    if (!pending) {
      pending = open().then(async (value) => {
        store = value
        if (value.migratedFrom) {
          try {
            await flushFile()
            log.info('[workspace-toolkit] migrated legacy store file:', value.migratedFrom)
          } catch (error) {
            log.warn('[workspace-toolkit] legacy store migration write failed:', error)
          }
        }
        return value
      }).catch((error) => {
        pending = null
        throw error
      })
    }
    return pending
  }

  async function flushFile() {
    const writable = JSON.stringify({ version: STORE_VERSION, workspaces: store.records, global: store.global })
    const file = store.file
    await writeChain.then(async () => {
      await mkdir(dirname(file), { recursive: true })
      const temp = file + '.tmp'
      await writeFile(temp, writable, 'utf8')
      await rename(temp, file)
    })
  }

  return {
    ensure,
    get records() { return store ? store.records : {} },
    get global() { return store ? store.global : DEFAULT_GLOBAL() },
    async setWorkspace(id, record) {
      await ensure()
      store.records[id] = record
      if (store.kind === 'storage') await store.unit.putRecord('workspaces', id, record)
      else await flushFile()
    },
    async deleteWorkspace(id) {
      await ensure()
      if (!(id in store.records)) return
      delete store.records[id]
      if (store.kind === 'storage') await store.unit.deleteRecord('workspaces', id)
      else await flushFile()
    },
    async setGlobal(next) {
      await ensure()
      store.global = normalizeGlobal(next)
      if (store.kind === 'storage') await store.unit.setGlobal(store.global)
      else await flushFile()
    },
    async close() {
      try {
        await ensure()
        if (store.kind === 'storage') await store.unit.close()
      } catch (error) {
        log.warn('[workspace-toolkit] store close failed:', error)
      }
    },
  }
}

// ---------------------------------------------------------------- Token 用量

function createUsageTracker(ctx) {
  const log = loggerOf(ctx)
  // sessionId -> { cursor, total }
  const cache = new Map()

  function addUsage(target, usage) {
    if (!usage || typeof usage !== 'object') return
    const input = Number(usage.inputTokens) || 0
    const output = Number(usage.outputTokens) || 0
    const cacheRead = Number(usage.cacheReadTokens) || 0
    const cacheWrite = Number(usage.cacheWriteTokens) || 0
    const reasoning = Number(usage.reasoningTokens) || 0
    const total = Number.isFinite(Number(usage.totalTokens)) ? Number(usage.totalTokens) : input + output
    target.inputTokens += input
    target.outputTokens += output
    target.cacheReadTokens += cacheRead
    target.cacheWriteTokens += cacheWrite
    target.reasoningTokens += reasoning
    target.totalTokens += total
  }

  async function sessionTotal(sessionId) {
    const cached = cache.get(sessionId)
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(new Error('observe timeout')), OBSERVE_TIMEOUT_MS) : null
    let observation
    try {
      observation = await ctx.sessionQuery.observeSession(sessionId, {
        projectionMode: 'none',
        ...controller ? { signal: controller.signal } : {},
      })
      if (cached && cached.cursor === observation.cursor) return cached.total
      const total = EMPTY_USAGE()
      const inherited = Number(observation.inheritedEventCount) || 0
      const events = Array.isArray(observation.events) ? observation.events : []
      for (const event of events) {
        if (!event || event.seq < inherited) continue
        if (event.type !== 'assistant/message') continue
        addUsage(total, event.data && event.data.usage)
      }
      cache.set(sessionId, { cursor: observation.cursor, total })
      return total
    } catch (error) {
      log.warn('[workspace-toolkit] unable to observe session', sessionId, error)
      return cached ? cached.total : null
    } finally {
      if (timer) clearTimeout(timer)
      // observation 是 caller-owned lease，必须释放，否则会 pin 住 prepared 缓存
      try { observation?.[Symbol.dispose]?.() } catch { /* ignore */ }
    }
  }

  return {
    /** @returns {Promise<Map<string, ReturnType<typeof EMPTY_USAGE>>>} sessionId -> usage */
    async collect(records) {
      const ids = []
      for (const record of records) {
        const header = record && record.header
        if (header && header.id) ids.push(header.id)
      }
      const totals = new Map()
      let next = 0
      // 有界并发：避免会话多时把宿主 IO 打满
      const workers = Array.from({ length: Math.min(OBSERVE_CONCURRENCY, ids.length) }, async () => {
        while (next < ids.length) {
          const id = ids[next]
          next += 1
          const total = await sessionTotal(id)
          if (total) totals.set(id, total)
        }
      })
      await Promise.all(workers)
      // 清掉已经不存在的会话，避免内存无限增长
      const liveIds = new Set(ids)
      for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id)
      return totals
    },
  }
}

// ---------------------------------------------------------------- 置顶（原生顺序）

function createPinner(ctx, store) {
  const log = loggerOf(ctx)

  /** 把 id 列表整理成：置顶块（pinnedOrder 中仍存在者）+ 其余（保持注册表当前顺序）。 */
  function desiredOrder(existingIds, pinnedOrder) {
    const around = existingIds.slice()
    const pinned = pinnedOrder.filter((id) => existingIds.includes(id))
    const pinnedSet = new Set(pinned)
    const rest = around.filter((id) => !pinnedSet.has(id))
    return [...pinned, ...rest]
  }

  /** 用 insertBefore 按 desired 重排（从后向前，每次插到下一个元素前面）。 */
  async function applyOrder(existingIds, desired) {
    if (desired.length <= 1) return existingIds
    const current = existingIds.join('\u0000')
    if (desired.join('\u0000') === current) return existingIds
    let latest = existingIds.slice()
    for (let index = desired.length - 2; index >= 0; index -= 1) {
      const id = desired[index]
      const beforeId = desired[index + 1]
      // 已经在前面的相邻对不需要写库，减少 durable 写入次数
      const atId = latest.indexOf(id)
      const atBefore = latest.indexOf(beforeId)
      if (atId >= 0 && atBefore >= 0 && atId < atBefore) continue
      try {
        latest = await ctx.workspaceRegistry.insertBefore(id, beforeId)
      } catch (error) {
        log.warn('[workspace-toolkit] insertBefore failed:', id, beforeId, error)
        return latest
      }
    }
    return latest
  }

  return {
    /** 注册表当前顺序是否已偏离「置顶块在前」的目标顺序（只读，不写库）。 */
    hasStaleOrder() {
      const existingIds = ctx.workspaceRegistry.list().map((workspace) => workspace.id)
      const global = store.global
      const pinnedOrder = pinnedOrderFor(global.pinnedOrder, existingIds, store.records)
      if (pinnedOrder.length === 0) return false
      const desired = desiredOrder(existingIds, pinnedOrder)
      return desired.join('\u0000') !== existingIds.join('\u0000')
    },
    /** 从旧数据（只有 records.pinned，没有 pinnedOrder）推导一次置顶顺序。 */
    bootstrapPinnedOrder() {
      const global = store.global
      if (global.pinnedOrder.length > 0) return global.pinnedOrder
      const existing = ctx.workspaceRegistry.list().map((workspace) => workspace.id)
      const derived = existing.filter((id) => Boolean(store.records[id] && store.records[id].pinned))
      return derived
    },
    async syncPinnedOrder(pinnedOrder) {
      const existingIds = ctx.workspaceRegistry.list().map((workspace) => workspace.id)
      const pinned = pinnedOrder.filter((id) => existingIds.includes(id))
      const global = store.global
      if (pinned.join('\u0000') !== global.pinnedOrder.join('\u0000')) {
        await store.setGlobal({ ...global, pinnedOrder: pinned })
      }
      return pinned
    },
    /**
     * 设置某工作区置顶状态，并把原生工作区顺序改写成「置顶块在前」。
     * @returns 最新注册表顺序
     */
    async setPinned(workspaceId, pinned) {
      const existingIds = ctx.workspaceRegistry.list().map((workspace) => workspace.id)
      if (!existingIds.includes(workspaceId)) return existingIds
      const global = store.global
      const pinnedOrder = pinnedOrderFor(global.pinnedOrder, existingIds, store.records)
      const without = pinnedOrder.filter((id) => id !== workspaceId)
      const nextPinned = pinned ? [workspaceId, ...without] : without
      await store.setGlobal({ ...global, pinnedOrder: nextPinned })
      const desired = desiredOrder(existingIds, nextPinned)
      return applyOrder(existingIds, desired)
    },
    /** 兜底：确保注册表顺序与 pinnedOrder 一致（插件启动 / 删除工作区后调用）。 */
    async reconcile() {
      const existingIds = ctx.workspaceRegistry.list().map((workspace) => workspace.id)
      const global = store.global
      const pinnedOrder = pinnedOrderFor(global.pinnedOrder, existingIds, store.records)
      if (pinnedOrder.length > 0) {
        const desired = desiredOrder(existingIds, pinnedOrder)
        return applyOrder(existingIds, desired)
      }
      return existingIds
    },
  }
}

/** 置顶列表以 store 为准；为空时从 records.pinned 推导（兼容旧数据）。 */
function pinnedOrderFor(pinnedOrder, existingIds, records) {
  const normalized = (Array.isArray(pinnedOrder) ? pinnedOrder : []).filter((id) => existingIds.includes(id))
  if (normalized.length > 0) return normalized
  return existingIds.filter((id) => Boolean(records[id] && records[id].pinned))
}

// ---------------------------------------------------------------- 插件

export function apply(ctx, config) {
  const log = loggerOf(ctx)
  const store = createStore(ctx)
  const usage = createUsageTracker(ctx)
  const pinner = createPinner(ctx, store)
  const modelCache = { at: 0, value: null }
  let lastClientReport = null

  // 监听工作区表变化（新建/删除/拖拽排序）：新建的工作区会被 prepend，
  // 需要把置顶块重新推回队首，否则用户会觉得「置顶失效了」。
  let reconcileTimer = null
  let reconcileRunning = false
  function scheduleReconcile() {
    if (reconcileTimer !== null) return
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null
      if (reconcileRunning) return
      reconcileRunning = true
      Promise.resolve()
        .then(() => pinner.reconcile())
        .catch((error) => log.warn('[workspace-toolkit] reconcile failed:', error))
        .then(() => { reconcileRunning = false })
    }, 250)
    if (typeof reconcileTimer === 'object' && reconcileTimer !== null && typeof reconcileTimer.unref === 'function') reconcileTimer.unref()
  }
  function clearReconcileTimer() {
    if (reconcileTimer === null) return
    clearTimeout(reconcileTimer)
    reconcileTimer = null
  }
  ctx.effect(() => {
    const controller = typeof ctx.get === 'function' ? ctx.get('workspaceController') : undefined
    if (!controller || typeof controller.follow !== 'function') return () => {}
    const abort = new AbortController()
    const run = async () => {
      try {
        for await (const frame of controller.follow(abort.signal)) {
          if (!frame) continue
          if (frame.type === 'order' || frame.type === 'upsert' || frame.type === 'remove') scheduleReconcile()
        }
      } catch (error) {
        if (!abort.signal.aborted) log.warn('[workspace-toolkit] workspace follow stopped:', error)
      }
    }
    run()
    return () => {
      abort.abort()
      clearReconcileTimer()
    }
  }, 'workspace-toolkit: workspace-follow')

  // 预打开存储、清理旧数据、按置顶顺序校正原生工作区顺序，并在卸载时关闭句柄
  ctx.effect(() => {
    store.ensure()
      .then(() => pinner.reconcile())
      .catch((error) => log.warn('[workspace-toolkit] store open failed:', error))
    return () => { store.close() }
  }, 'workspace-toolkit: store')

  function readDefaultModel() {
    try {
      const service = ctx.get('agentDefaultModel')
      const selection = service && typeof service.currentSelection === 'function' ? service.currentSelection() : null
      return sanitizeModel(selection)
    } catch {
      return null
    }
  }

  async function modelCatalog() {
    if (modelCache.value && Date.now() - modelCache.at < MODEL_CACHE_MS) return modelCache.value
    const providers = []
    let providerList = []
    try {
      providerList = await ctx.llm.listProviders()
    } catch (error) {
      log.warn('[workspace-toolkit] listProviders failed:', error)
    }
    for (const provider of Array.isArray(providerList) ? providerList : []) {
      const id = provider && provider.id
      if (!id) continue
      let models = []
      try {
        models = await ctx.llm.listModels(id)
      } catch (error) {
        log.warn('[workspace-toolkit] listModels failed for', id, error)
      }
      providers.push({
        id,
        name: (provider && (provider.name || provider.id)) || id,
        models: (Array.isArray(models) ? models : []).map((model) => ({
          id: model.id,
          name: model.name || model.id,
          description: model.description || '',
        })),
      })
    }
    modelCache.at = Date.now()
    modelCache.value = { providers }
    return modelCache.value
  }

  /**
   * 自定义模型供应商管理。
   *
   * 这些供应商不是插件自己实现的适配器，而是写进 Harness 官方 pi-ai 适配器 entry 的
   * `config.providers`（通过 configEditor 服务持久化 + 走 Loader 正常 reconcile），
   * 因此界面里新增/修改的供应商与手写在 cordis.patch.yml 里的完全等价：
   * 会话请求由 pi-ai 负责，插件只负责「编辑这份配置」和「测试连通性」。
   */
  function sanitizeRoute(value) {
    if (typeof value !== 'string') return ''
    const route = value.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(route)) return ''
    return route
  }

  function deriveApiKeyEnv(route) {
    const stem = route.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
    return (stem || 'CUSTOM') + '_API_KEY'
  }

  function sanitizeHeaders(raw) {
    const headers = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return headers
    let count = 0
    for (const [name, value] of Object.entries(raw)) {
      if (count >= 20) break
      if (typeof name !== 'string' || !HEADER_NAME_PATTERN.test(name)) continue
      if (typeof value !== 'string') continue
      headers[name] = value.slice(0, 512)
      count += 1
    }
    return headers
  }

  function normalizeModels(raw) {
    const models = []
    if (!Array.isArray(raw)) return models
    for (const entry of raw.slice(0, 40)) {
      if (!entry || typeof entry !== 'object') continue
      const id = typeof entry.id === 'string' ? entry.id.trim().slice(0, 200) : ''
      if (!id) continue
      const model = { id }
      if (typeof entry.name === 'string' && entry.name.trim()) model.name = entry.name.trim().slice(0, 200)
      if (Number.isFinite(entry.contextWindow) && entry.contextWindow > 0) model.contextWindow = Math.floor(entry.contextWindow)
      if (Number.isFinite(entry.maxTokens) && entry.maxTokens > 0) model.maxTokens = Math.floor(entry.maxTokens)
      if (Array.isArray(entry.input)) {
        const inputs = Array.from(new Set(entry.input.filter((item) => item === 'text' || item === 'image')))
        if (inputs.length) model.input = inputs
      }
      models.push(model)
    }
    return models
  }

  /** 只接受白名单字段，避免把任意结构写进宿主配置 */
  function cleanProviderPatch(raw) {
    const patch = {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return patch
    if (typeof raw.displayName === 'string') patch.displayName = raw.displayName.trim().slice(0, 120)
    if (typeof raw.api === 'string' && PROVIDER_APIS.has(raw.api)) patch.api = raw.api
    if (typeof raw.baseURL === 'string') {
      const url = raw.baseURL.trim().slice(0, 500)
      if (url === '' || /^https?:\/\//i.test(url)) patch.baseURL = url
    }
    if (raw.headers !== undefined) patch.headers = sanitizeHeaders(raw.headers)
    if (raw.models !== undefined) patch.models = normalizeModels(raw.models)
    if (typeof raw.apiKeyEnv === 'string') patch.apiKeyEnv = raw.apiKeyEnv.trim().slice(0, 120)
    return patch
  }

  function configEditorEntry() {
    const editor = ctx.get('configEditor')
    if (!editor || typeof editor.entries !== 'function') return { editor: null, entry: null }
    try {
      const entries = editor.entries()
      const list = Array.isArray(entries) ? entries : []
      // configEditor.entries() 返回 Loader entry：{ options: { id, name, config }, fiber, parent }。
      // 为了兼容简单 mock 也接受扁平 { id, name }。
      const idOf = (item) => (item && item.options && typeof item.options.id === 'string' ? item.options.id : (item && typeof item.id === 'string' ? item.id : ''))
      const nameOf = (item) => (item && item.options && typeof item.options.name === 'string' ? item.options.name : (item && typeof item.name === 'string' ? item.name : ''))
      const entry = list.find((item) => idOf(item) === PI_AI_ENTRY_ID)
        || list.find((item) => nameOf(item).includes('llm-pi-ai'))
        || null
      return { editor, entry }
    } catch (error) {
      log.warn('[workspace-toolkit] configEditor.entries failed:', error)
      return { editor: null, entry: null }
    }
  }

  async function readProviderConfig() {
    const { editor, entry } = configEditorEntry()
    if (!editor || !entry) return { available: false, providers: {} }
    try {
      const rows = await Promise.resolve(editor.configuration())
      const row = Array.isArray(rows) ? rows.find((item) => item && item.entry === entry) : undefined
      const inherited = (row && row.inherited && typeof row.inherited === 'object') ? row.inherited : {}
      const override = (row && row.override && typeof row.override === 'object') ? row.override : {}
      const providers = {
        ...(inherited.providers && typeof inherited.providers === 'object' ? inherited.providers : {}),
        ...(override.providers && typeof override.providers === 'object' ? override.providers : {}),
      }
      return { available: true, entry, providers }
    } catch (error) {
      log.warn('[workspace-toolkit] configEditor.configuration failed:', error)
      return { available: false, providers: {} }
    }
  }

  function credentialState(ref) {
    if (!ref) return false
    const credentials = ctx.get('credentials')
    if (credentials && typeof credentials.describe === 'function') {
      try {
        const info = credentials.describe(ref)
        if (info && typeof info.then === 'function') {
          return info.then((value) => Boolean(value && value.configured))
        }
        return Boolean(info && info.configured)
      } catch (error) {
        log.warn('[workspace-toolkit] credentials.describe failed:', error)
      }
    }
    return Boolean(process.env[ref])
  }

  function providerView(route, config, keyConfigured) {
    const raw = config && typeof config === 'object' ? config : {}
    const apiKeyEnv = typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim() ? raw.apiKeyEnv.trim() : ''
    return {
      route,
      displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
      api: typeof raw.api === 'string' ? raw.api : 'openai-completions',
      baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : '',
      headers: sanitizeHeaders(raw.headers),
      models: normalizeModels(raw.models),
      apiKeyEnv: apiKeyEnv || deriveApiKeyEnv(route),
      apiKeyEnvExplicit: Boolean(apiKeyEnv),
      keyConfigured: Boolean(keyConfigured),
    }
  }

  async function providersSnapshot() {
    const { available, providers } = await readProviderConfig()
    const list = []
    for (const [route, config] of Object.entries(providers)) {
      const raw = config && typeof config === 'object' ? config : {}
      const ref = (typeof raw.apiKeyEnv === 'string' && raw.apiKeyEnv.trim()) || deriveApiKeyEnv(route)
      let keyConfigured = false
      try {
        keyConfigured = Boolean(await credentialState(ref))
      } catch (error) {
        log.warn('[workspace-toolkit] credential state failed:', error)
      }
      list.push(providerView(route, raw, keyConfigured))
    }
    list.sort((a, b) => a.route.localeCompare(b.route))
    return { available, entryId: PI_AI_ENTRY_ID, providers: list }
  }

  async function resolveApiKey(ref) {
    if (!ref) return ''
    const credentials = ctx.get('credentials')
    if (credentials && typeof credentials.resolve === 'function') {
      try {
        const hit = await Promise.resolve(credentials.resolve(ref))
        if (hit && typeof hit.value === 'string' && hit.value) return hit.value
      } catch (error) {
        log.warn('[workspace-toolkit] credentials.resolve failed:', error)
      }
    }
    const fromEnv = process.env[ref]
    return typeof fromEnv === 'string' ? fromEnv : ''
  }

  async function saveProvider(body) {
    const { editor, entry } = configEditorEntry()
    if (!editor || !entry || typeof editor.edit !== 'function') {
      return { ok: false, error: 'config-editor-unavailable' }
    }
    const route = sanitizeRoute(body && body.route)
    if (!route) return { ok: false, error: 'invalid-route' }
    const rawPatch = body && body.patch && typeof body.patch === 'object' ? body.patch : {}
    const remove = rawPatch.delete === true || (body && body.remove === true)
    const apiKey = typeof rawPatch.apiKey === 'string' ? rawPatch.apiKey.trim() : ''
    const next = cleanProviderPatch(rawPatch)
    delete next.delete
    if (next.baseURL !== undefined && next.baseURL === '') delete next.baseURL

    if (apiKey) {
      const credentials = ctx.get('credentials')
      if (!credentials || typeof credentials.set !== 'function') return { ok: false, error: 'credentials-unavailable' }
      const ref = next.apiKeyEnv || deriveApiKeyEnv(route)
      try {
        await Promise.resolve(credentials.set(ref, apiKey))
      } catch (error) {
        log.warn('[workspace-toolkit] credentials.set failed:', error)
        return { ok: false, error: 'credential-write-failed: ' + String((error && error.message) || error) }
      }
      next.apiKeyEnv = ref
    }

    const current = await readProviderConfig()
    if (!current.available) return { ok: false, error: 'config-editor-unavailable' }
    try {
      await Promise.resolve(editor.edit(entry, (raw) => {
        const base = raw && typeof raw === 'object' ? raw : {}
        const providers = { ...(base.providers && typeof base.providers === 'object' ? base.providers : {}) }
        if (remove) {
          delete providers[route]
        } else {
          providers[route] = { ...(providers[route] && typeof providers[route] === 'object' ? providers[route] : {}), ...next }
        }
        return { ...base, providers }
      }))
    } catch (error) {
      log.warn('[workspace-toolkit] configEditor.edit failed:', error)
      return { ok: false, error: 'config-write-failed: ' + String((error && error.message) || error) }
    }
    // 供应商目录缓存立即失效，下一次快照重新向 llm 服务取
    modelCache.at = 0
    modelCache.value = null
    log.info('[workspace-toolkit] custom provider saved:', { route, remove, models: next.models ? next.models.length : undefined })
    return { ok: true, route, removed: remove }
  }

  async function testProvider(body) {
    const route = sanitizeRoute(body && body.route)
    if (!route) return { ok: false, error: 'invalid-route' }
    const { available, providers } = await readProviderConfig()
    if (!available) return { ok: false, error: 'config-editor-unavailable' }
    const config = providers[route]
    if (!config || typeof config !== 'object') return { ok: false, error: 'unknown-route' }
    const api = typeof config.api === 'string' ? config.api : 'openai-completions'
    const baseURL = typeof config.baseURL === 'string' ? config.baseURL.replace(/\/+$/, '') : ''
    if (!baseURL) return { ok: false, error: 'baseURL-missing' }
    const models = normalizeModels(config.models)
    const model = (body && typeof body.model === 'string' && body.model.trim()) || (models[0] && models[0].id) || route
    const ref = (typeof config.apiKeyEnv === 'string' && config.apiKeyEnv.trim()) || deriveApiKeyEnv(route)
    const apiKey = await resolveApiKey(ref)
    const headers = { 'content-type': 'application/json', ...sanitizeHeaders(config.headers) }
    if (api === 'anthropic-messages') {
      headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01'
      if (apiKey) headers['x-api-key'] = apiKey
    } else if (apiKey) {
      headers.authorization = 'Bearer ' + apiKey
    }
    const url = api === 'anthropic-messages' ? baseURL + '/messages' : baseURL + '/chat/completions'
    const payload = api === 'anthropic-messages'
      ? { model, max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }
      : { model, max_tokens: 16, stream: false, messages: [{ role: 'user', content: 'ping' }] }
    const startedAt = Date.now()
    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(PROVIDER_TEST_TIMEOUT_MS),
      })
    } catch (error) {
      const message = String((error && error.message) || error)
      log.warn('[workspace-toolkit] provider test transport failed:', { route, url, message })
      return { ok: false, route, url, latencyMs: Date.now() - startedAt, error: 'network-error: ' + message }
    }
    const latencyMs = Date.now() - startedAt
    let text = ''
    try {
      text = (await response.text()).slice(0, 2000)
    } catch {
      text = ''
    }
    let detail = text
    try {
      const parsed = JSON.parse(text)
      detail = parsed && (parsed.error && (parsed.error.message || parsed.error.code)) ? String(parsed.error.message || parsed.error.code) : (parsed && parsed.model ? 'model=' + parsed.model : JSON.stringify(parsed).slice(0, 400))
    } catch {
      detail = text.slice(0, 400)
    }
    log.info('[workspace-toolkit] provider test:', { route, url, status: response.status, ok: response.ok, latencyMs })
    return { ok: response.ok, route, url, status: response.status, latencyMs, detail }
  }

  function workspaceMeta(workspaceId) {
    const record = store.records[workspaceId]
    if (!record || typeof record !== 'object') {
      return { pinned: false, note: '', color: '', model: null }
    }
    return {
      pinned: Boolean(record.pinned),
      note: typeof record.note === 'string' ? record.note : '',
      color: typeof record.color === 'string' ? record.color : '',
      model: sanitizeModel(record.model),
    }
  }

  async function buildSnapshot(forceUsage) {
    const state = await store.ensure()
    const global = state.global
    let records = []
    try {
      records = await ctx.sessionQuery.listSessions()
    } catch (error) {
      log.warn('[workspace-toolkit] listSessions failed:', error)
    }
    const totals = await usage.collect(Array.isArray(records) ? records : [])
    const catalog = await modelCatalog()
    // 新建工作区会被注册表 prepend 到顺序最前面（dsh-workspace create() 的既定行为），
    // 因此每次取快照前先校正一次置顶顺序，保证置顶工作区始终在最前。
    if (pinner.hasStaleOrder()) {
      try {
        await pinner.reconcile()
      } catch (error) {
        log.warn('[workspace-toolkit] reconcile before snapshot failed:', error)
      }
    }
    const registry = ctx.workspaceRegistry.list()
    const existingIds = registry.map((workspace) => workspace.id)
    const pinnedOrder = pinnedOrderFor(global.pinnedOrder, existingIds, state.records)
    const workspaces = []
    for (const workspace of registry) {
      const meta = workspaceMeta(workspace.id)
      const sessionIds = Array.from(workspace.sessionIds || [])
      // 按 registry 的会话归属累加；同一会话只算一次
      const bucket = EMPTY_USAGE()
      for (const sessionId of sessionIds) {
        const total = totals.get(sessionId)
        if (!total) continue
        bucket.inputTokens += total.inputTokens
        bucket.outputTokens += total.outputTokens
        bucket.totalTokens += total.totalTokens
        bucket.cacheReadTokens += total.cacheReadTokens
        bucket.cacheWriteTokens += total.cacheWriteTokens
        bucket.reasoningTokens += total.reasoningTokens
        bucket.sessions += 1
      }
      workspaces.push({
        workspaceId: workspace.id,
        path: workspace.path,
        title: workspace.title,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        sessionIds,
        sessionCount: sessionIds.length,
        pinned: pinnedOrder.includes(workspace.id) || meta.pinned,
        note: meta.note,
        color: meta.color,
        model: meta.model,
        usage: bucket,
      })
    }
    return {
      ok: true,
      version: SNAPSHOT_VERSION,
      settings: { ...global.settings },
      pinnedOrder,
      workspaces,
      models: { providers: catalog.providers },
      customProviders: await providersSnapshot().catch((error) => {
        log.warn('[workspace-toolkit] providers snapshot failed:', error)
        return { available: false, entryId: PI_AI_ENTRY_ID, providers: [] }
      }),
      defaultModel: readDefaultModel(),
      usageAt: new Date().toISOString(),
      force: Boolean(forceUsage),
    }
  }

  async function updateWorkspaceMeta(body) {
    const state = await store.ensure()
    const now = new Date().toISOString()
    // 支持两种调用形态：单个工作区 { workspaceId, patch }，或批量 { items: [{ workspaceId, patch }] }。
    const items = Array.isArray(body && body.items)
      ? body.items
      : [{ workspaceId: body && body.workspaceId, patch: body && body.patch }]
    if (items.length === 0) return { ok: false, error: 'workspaceId required' }
    const known = new Set(ctx.workspaceRegistry.list().map((workspace) => workspace.id))
    let changed = 0
    let pinnedTouched = false
    for (const item of items) {
      const workspaceId = typeof (item && item.workspaceId) === 'string' ? item.workspaceId.trim() : ''
      if (!workspaceId) return { ok: false, error: 'workspaceId required' }
      if (!known.has(workspaceId)) return { ok: false, error: 'unknown workspaceId' }
      const patch = sanitizePatch(item && item.patch)
      if (Object.keys(patch).length === 0) continue
      const current = state.records[workspaceId] || {}
      const next = { ...current, updatedAt: now }
      if ('model' in patch) next.model = patch.model
      if ('note' in patch) next.note = patch.note
      if ('color' in patch) next.color = patch.color
      if ('pinned' in patch) next.pinned = patch.pinned
      await store.setWorkspace(workspaceId, next)
      if ('pinned' in patch) {
        pinnedTouched = true
        await pinner.setPinned(workspaceId, patch.pinned)
      }
      changed += 1
    }
    if (pinnedTouched) await buildSnapshotAfterPin()
    return { ok: true, changed }
  }

  async function buildSnapshotAfterPin() {
    const existingIds = ctx.workspaceRegistry.list().map((workspace) => workspace.id)
    const global = store.global
    const pinnedOrder = pinnedOrderFor(global.pinnedOrder, existingIds, store.records)
    await store.setGlobal({ ...global, pinnedOrder })
  }

  async function updateSettings(body) {
    const patch = body && typeof body.patch === 'object' && body.patch ? body.patch : {}
    const state = await store.ensure()
    const settings = { ...state.global.settings }
    if ('showSidebarEntry' in patch) settings.showSidebarEntry = patch.showSidebarEntry !== false
    await store.setGlobal({ ...state.global, settings })
    return { ok: true }
  }

  function route(method, handler) {
    return (req, res) => {
      if (method !== undefined && req.method !== method) {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      Promise.resolve()
        .then(() => handler(req))
        .then((value) => sendJson(res, 200, value))
        .catch((error) => {
          log.warn('[workspace-toolkit] route failed:', error)
          sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
        })
    }
  }

  // 诊断：首帧快照成功下发一次后记一条 info，便于在宿主日志里确认「host ↔ 页面」链路已通
  let snapshotServedToClient = ''
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/snapshot',
    handler: route('GET', async (req) => {
      const url = new URL(req.url || ROUTE_PREFIX, 'http://localhost')
      const force = url.searchParams.get('force') === '1' || url.searchParams.get('refresh') === '1'
      const snapshot = await buildSnapshot(force)
      const providerIds = snapshot.models && Array.isArray(snapshot.models.providers)
        ? snapshot.models.providers.map((entry) => entry.id).join(',')
        : ''
      const custom = snapshot.customProviders
      const customIds = custom && custom.available
        ? custom.providers.map((entry) => entry.route).join(',')
        : 'unavailable'
      const fingerprint = providerIds + '|' + customIds
      if (fingerprint !== snapshotServedToClient) {
        snapshotServedToClient = fingerprint
        log.info('[workspace-toolkit] snapshot served to page:', {
          workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces.length : 0,
          store: typeof store.kind === 'string' ? store.kind : 'unknown',
          providers: providerIds,
          customProviders: customIds,
        })
      }
      return snapshot
    }),
  }), 'workspace-toolkit: snapshot route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/meta',
    handler: route('POST', async (req) => {
      const result = await updateWorkspaceMeta(await readJsonBody(req))
      if (!result.ok) return result
      return buildSnapshot(false)
    }),
  }), 'workspace-toolkit: meta route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/settings',
    handler: route('POST', async (req) => {
      const result = await updateSettings(await readJsonBody(req))
      if (!result.ok) return result
      return buildSnapshot(false)
    }),
  }), 'workspace-toolkit: settings route')

  // 客户端插槽注册 / DOM 装饰失败时的诊断上报（无浏览器控制时用于排查）。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/client-report',
    handler: route(undefined, async (req) => {
      if (req.method === 'GET') return { ok: true, report: lastClientReport }
      if (req.method !== 'POST') return { ok: false, error: 'method not allowed' }
      const body = await readJsonBody(req)
      const errors = Array.isArray(body && body.errors) ? body.errors.slice(0, 20) : []
      lastClientReport = {
        at: typeof (body && body.at) === 'string' ? body.at : new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        applied: body && body.applied === true,
        href: typeof (body && body.href) === 'string' ? body.href : '',
        errors: errors.map((item) => ({
          label: item && typeof item.label === 'string' ? item.label.slice(0, 120) : '',
          message: item && typeof item.message === 'string' ? item.message.slice(0, 500) : '',
        })),
      }
      for (const item of lastClientReport.errors) {
        log.warn('[workspace-toolkit] client error:', item.label, item.message)
      }
      return { ok: true, count: lastClientReport.errors.length }
    }),
  }), 'workspace-toolkit: client-report route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/ping',
    handler: route('GET', async () => {
      const state = await store.ensure()
      const workspaces = ctx.workspaceRegistry.list()
      return {
        ok: true,
        store: state.kind,
        file: state.kind === 'file' ? state.file : undefined,
        workspaceCount: workspaces.length,
        metaCount: Object.keys(state.records).length,
        pinnedOrder: state.global.pinnedOrder,
        showSidebarEntry: state.global.settings.showSidebarEntry,
        modelProviders: (modelCache.value ? modelCache.value.providers.length : null),
        lastClientReport,
      }
    }),
  }), 'workspace-toolkit: ping route')

  // 自定义模型供应商：读写 pi-ai 适配器 entry 的 config.providers（官方 configEditor 服务落盘 + reconcile）。
  // 同一 path 支持 GET（列表）与 POST（保存/删除），故只注册一条路由并按 method 分派。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/providers',
    handler: route(undefined, async (req) => {
      if (req.method === 'GET') return providersSnapshot()
      if (req.method !== 'POST') return { ok: false, error: 'method not allowed' }
      const result = await saveProvider(await readJsonBody(req))
      if (!result.ok) return result
      return { ...result, customProviders: await providersSnapshot() }
    }),
  }), 'workspace-toolkit: providers route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PREFIX + '/providers/test',
    handler: route('POST', async (req) => testProvider(await readJsonBody(req))),
  }), 'workspace-toolkit: provider test route')

  // 为新建的 Agent 应用所属工作区的模型覆盖。
  // agent/created 是 serial 事件：所有监听器 await 完成后创建才 resolve，首个请求一定使用这里选定的模型。
  ctx.on('agent/created', async (payload) => {
    try {
      const agent = payload && payload.agent
      if (!agent || !agent.model || !agent.session) return
      const header = (agent.session.header || {})
      // 子代理会话继承父会话的模型，不按工作区覆盖。
      if (header.origin === 'subagent' || header.parentSession) return
      // 覆写「全新会话」与「恢复的会话」的默认模型：恢复时如果该会话从未自己选过模型
      // （下面会检查 model/selection 事件），说明它一直跟着全局默认走，此时应跟随工作区配置。
      // 清理 / 压缩（同一会话的续用）一律不动。
      if (payload.source !== 'startup' && payload.source !== 'resume') return
      await store.ensure()
      const workspace = findWorkspaceForCwd(ctx, header.cwd)
      if (!workspace) return
      const meta = workspaceMeta(workspace.id)
      if (!meta.model) return
      // agent.model.current() 在没有任何记录时会回退到全局默认模型（恒为真），
      // 因此不能用它判断用户是否已显式选择，改为检查请求头与 model/selection 事件。
      if (typeof agent.session.requestHeader === 'function' && agent.session.requestHeader() !== undefined) return
      let recorded = false
      try {
        const events = typeof agent.session.ownEvents === 'function' ? agent.session.ownEvents() : []
        for (const event of events) {
          if (event && event.type === 'model/selection') { recorded = true; break }
        }
      } catch { /* 读不到事件时按未记录处理 */ }
      if (recorded) return
      agent.model.select(meta.model)
      log.info?.('[workspace-toolkit] applied workspace model', workspace.id, meta.model.provider + '/' + meta.model.model)
    } catch (error) {
      log.warn('[workspace-toolkit] failed to apply workspace model:', error)
    }
  })
}

/** 按会话 cwd 找所属工作区：先精确匹配 path，再用 resolveByPath 兜底。 */
function findWorkspaceForCwd(ctx, cwd) {
  const target = normalizePath(cwd)
  if (!target) return null
  const list = ctx.workspaceRegistry.list()
  const direct = list.find((workspace) => normalizePath(workspace.path) === target)
  if (direct) return direct
  try {
    if (typeof ctx.workspaceRegistry.resolveByPath === 'function') {
      const resolved = ctx.workspaceRegistry.resolveByPath(target)
      if (resolved) return resolved
    }
  } catch { /* 解析失败按未匹配处理 */ }
  return null
}
