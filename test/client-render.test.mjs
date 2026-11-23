// 极简 client 渲染 / 幂等测试。
//
// 不依赖 jsdom、不依赖真实 React：用 20 行 React mock 和一个支持
// appendChild/querySelector（class 片段与属性选择器）的假 DOM，验证：
//   - 模块形态与 apply 生命周期内注册的槽位
//   - 追加式装饰层的幂等性（重复 decorate 不重复节点）与颜色 style 规则
//   - settings / overview 的渲染与空数据降级，右键菜单动作，追加式装饰层
//   - locale 词典与 JSON 的 key 完整性
// 运行：node test/client-render.test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const clientPath = path.join(root, 'client.js')
const zhPath = path.join(root, 'locale/zh.json')
const enPath = path.join(root, 'locale/en.json')

// ------------------------------------------------------------ 假 DOM

const SELECTOR_RE = /\[([a-zA-Z0-9_:-]+)(?:([*^$]?=)"([^"]*)")?\]/g

function parseSelector(selector) {
  return String(selector || '').split(',').map((part) => {
    const text = part.trim()
    const tagMatch = text.match(/^([a-zA-Z][a-zA-Z0-9-]*)/)
    const attrs = []
    SELECTOR_RE.lastIndex = 0
    let match = SELECTOR_RE.exec(text)
    while (match) {
      attrs.push({ name: match[1], op: match[2] || '', value: match[3] })
      match = SELECTOR_RE.exec(text)
    }
    return { tag: tagMatch ? tagMatch[1].toUpperCase() : null, attrs }
  })
}

function attrValue(el, name) {
  return el.attributes[name] === undefined ? null : el.attributes[name]
}

function matchesCompound(el, compound) {
  if (compound.tag && el.tagName !== compound.tag) return false
  for (const attr of compound.attrs) {
    const value = attrValue(el, attr.name)
    if (attr.op === '') {
      if (value === null) return false
    } else if (attr.op === '=') {
      if (value !== attr.value) return false
    } else if (attr.op === '*=') {
      if (value === null || !String(value).includes(attr.value)) return false
    } else if (attr.op === '^=') {
      if (value === null || !String(value).startsWith(attr.value)) return false
    } else if (attr.op === '$=') {
      if (value === null || !String(value).endsWith(attr.value)) return false
    }
  }
  return true
}

function matches(el, selector) {
  const compounds = parseSelector(selector)
  return compounds.some((compound) => matchesCompound(el, compound))
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.attributes = {}
    this.children = []
    this.parentNode = null
    this._text = ''
    this.__onclick = null
    this.__listeners = {}
  }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent).join('')
    return this._text
  }

  set textContent(value) {
    this._text = value === null || value === undefined ? '' : String(value)
    this.children.forEach((child) => { child.parentNode = null })
    this.children = []
  }

  get firstElementChild() { return this.children[0] || null }

  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name] }
  hasAttribute(name) { return this.attributes[name] !== undefined }
  removeAttribute(name) { delete this.attributes[name] }
  set className(value) { this.setAttribute('class', value) }
  get className() { return this.attributes.class || '' }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }

  insertBefore(child, reference) {
    if (child.parentNode) child.parentNode.removeChild(child)
    const index = reference ? this.children.indexOf(reference) : -1
    child.parentNode = this
    if (index < 0) this.children.push(child)
    else this.children.splice(index, 0, child)
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }

  addEventListener(type, handler) {
    this.__listeners[type] = this.__listeners[type] || []
    this.__listeners[type].push(handler)
    if (type === 'click') this.__onclick = handler
  }

  removeEventListener(type, handler) {
    const list = this.__listeners[type] || []
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
    if (type === 'click' && this.__onclick === handler) this.__onclick = null
  }

  click() {
    if (typeof this.__onclick === 'function') {
      this.__onclick({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} })
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  querySelectorAll(selector) {
    const out = []
    const walk = (node) => {
      node.children.forEach((child) => {
        if (matches(child, selector)) out.push(child)
        walk(child)
      })
    }
    walk(this)
    return out
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeElement('head')
    this.body = new FakeElement('body')
    this.visibilityState = 'visible'
    this.__listeners = {}
  }

  createElement(tag) { return new FakeElement(tag) }
  createElementNS(_namespace, tag) { return new FakeElement(tag) }

  addEventListener(type, handler) {
    this.__listeners[type] = this.__listeners[type] || []
    this.__listeners[type].push(handler)
  }

  removeEventListener(type, handler) {
    const list = this.__listeners[type] || []
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null }

  querySelectorAll(selector) {
    const out = []
    const roots = [this.head, this.body]
    roots.forEach((node) => {
      if (matches(node, selector)) out.push(node)
      out.push(...node.querySelectorAll(selector))
    })
    return out
  }
}

// ------------------------------------------------------------ React mock（最小重渲染运行时）

let effectCleanups = []
let currentInstance = null
let currentSession = null

function sameDeps(a, b) {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false
  return true
}

const ReactMock = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    const kids = []
    children.forEach((child) => {
      if (Array.isArray(child)) kids.push(...child)
      else if (child !== undefined) kids.push(child)
    })
    merged.children = kids.length ? kids : (merged.children === undefined ? null : merged.children)
    return { type, props: merged }
  },
  useState(initial) {
    const instance = currentInstance
    const index = instance.hookIndex
    instance.hookIndex += 1
    if (!(index in instance.hooks)) instance.hooks[index] = typeof initial === 'function' ? initial() : initial
    const setState = (value) => {
      const next = typeof value === 'function' ? value(instance.hooks[index]) : value
      if (Object.is(instance.hooks[index], next)) return
      instance.hooks[index] = next
      scheduleRender(instance.session)
    }
    return [instance.hooks[index], setState]
  },
  useEffect(fn, deps) {
    const instance = currentInstance
    const index = instance.hookIndex
    instance.hookIndex += 1
    currentSession.pendingEffects.push({
      instance, index, fn,
      deps: Array.isArray(deps) ? deps.slice() : null,
    })
  },
  useLayoutEffect(fn, deps) { ReactMock.useEffect(fn, deps) },
  useMemo(fn, deps) {
    const instance = currentInstance
    const index = instance.hookIndex
    instance.hookIndex += 1
    const previous = instance.hooks[index]
    if (previous && Array.isArray(deps) && sameDeps(previous.deps, deps)) return previous.value
    const value = fn()
    instance.hooks[index] = { value, deps: Array.isArray(deps) ? deps.slice() : null }
    return value
  },
  useCallback(fn, deps) { return ReactMock.useMemo(() => fn, deps) },
  useRef(initial) {
    const instance = currentInstance
    const index = instance.hookIndex
    instance.hookIndex += 1
    if (!(index in instance.hooks)) instance.hooks[index] = { current: initial }
    return instance.hooks[index]
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    const value = getSnapshot()
    const instance = currentInstance
    const index = instance.hookIndex
    instance.hookIndex += 1
    currentSession.pendingEffects.push({
      instance,
      index: 'subscribe:' + index,
      deps: [],
      fn() { return subscribe(() => scheduleRender(instance.session)) },
    })
    return value
  },
}

function scheduleRender(session) {
  if (!session || session.scheduled) return
  session.scheduled = true
  setTimeout(() => {
    session.scheduled = false
    rerender(session)
  }, 0)
}

function applyProps(el, props) {
  Object.keys(props || {}).forEach((key) => {
    const value = props[key]
    if (key === 'children' || key === 'key' || key === 'ref') return
    if (key === 'style' || key === 'dangerouslySetInnerHTML') return
    if (key === 'className') { el.setAttribute('class', value || ''); return }
    if (key === 'onClick') { el.__onclick = value; return }
    if (key === 'onChange' || key === 'onBlur' || key === 'onKeyDown' || key === 'onInput') {
      el.__listeners[key] = value
      return
    }
    if (value === true) { el.setAttribute(key, ''); return }
    if (value === false || value === null || value === undefined) return
    el.setAttribute(key, String(value))
  })
}

function renderChildren(session, children, parent, path) {
  if (children === null || children === undefined || children === false || children === true) return
  if (Array.isArray(children)) {
    children.forEach((child, index) => renderElement(session, child, parent, path + '/' + index))
    return
  }
  renderElement(session, children, parent, path + '/0')
}

function renderElement(session, element, parent, path) {
  const doc = session.doc
  if (element === null || element === undefined || element === false || element === true) return
  if (Array.isArray(element)) {
    element.forEach((child, index) => renderElement(session, child, parent, path + '/' + index))
    return
  }
  if (typeof element === 'string' || typeof element === 'number') {
    const text = doc.createElement('#text')
    text.textContent = String(element)
    parent.appendChild(text)
    return
  }
  if (element.type === ReactMock.Fragment) {
    renderChildren(session, element.props && element.props.children, parent, path + '/#')
    return
  }
  if (typeof element.type === 'function') {
    const key = 'c:' + path
    let instance = session.instances.get(key)
    if (!instance) {
      instance = { hooks: [], hookIndex: 0, effects: {}, session }
      session.instances.set(key, instance)
    }
    instance.session = session
    instance.hookIndex = 0
    const savedInstance = currentInstance
    const savedSession = currentSession
    currentInstance = instance
    currentSession = session
    let output
    try {
      output = element.type(Object.assign({}, element.props || {}))
    } finally {
      currentInstance = savedInstance
      currentSession = savedSession
    }
    renderElement(session, output, parent, path + '/' + element.type.name)
    return
  }
  const el = doc.createElement(element.type)
  applyProps(el, element.props || {})
  renderChildren(session, element.props && element.props.children, el, path + '/' + element.type)
  parent.appendChild(el)
}

function flushEffects(session) {
  const pending = session.pendingEffects
  session.pendingEffects = []
  pending.forEach((entry) => {
    const instance = entry.instance
    const previous = instance.effects[entry.index]
    if (previous && entry.deps && previous.deps && sameDeps(previous.deps, entry.deps)) return
    if (previous && typeof previous.cleanup === 'function') {
      try { previous.cleanup() } catch (ignored) { /* 清理失败忽略 */ }
    }
    let cleanup = null
    try { cleanup = entry.fn() } catch (ignored) { /* effect 抛错不中断渲染 */ }
    instance.effects[entry.index] = {
      deps: entry.deps ? entry.deps.slice() : null,
      cleanup: typeof cleanup === 'function' ? cleanup : null,
    }
    if (typeof cleanup === 'function') effectCleanups.push(cleanup)
  })
}

function rerender(session) {
  session.host.textContent = ''
  session.pendingEffects = []
  renderElement(session, session.element, session.host, '')
  flushEffects(session)
}

function render(component, props, doc) {
  const host = doc.createElement('div')
  const session = {
    doc,
    host,
    element: null,
    instances: new Map(),
    pendingEffects: [],
    scheduled: false,
  }
  session.element = ReactMock.createElement(component, props)
  renderElement(session, session.element, host, '')
  flushEffects(session)
  return host
}

function settle(times) {
  const rounds = times || 8
  let promise = Promise.resolve()
  for (let i = 0; i < rounds; i += 1) {
    promise = promise.then(() => new Promise((resolve) => setTimeout(resolve, 0)))
  }
  return promise
}

// ------------------------------------------------------------ 测试工具

const checks = []
let failed = 0

function check(name, condition, detail) {
  const ok = !!condition
  checks.push({ name, ok, detail })
  if (!ok) {
    failed += 1
    console.log('FAIL', name, detail === undefined ? '' : detail)
  }
}

function findButtonByText(node, text) {
  const buttons = node.querySelectorAll('button')
  for (const button of buttons) {
    if (button.textContent.indexOf(text) >= 0) return button
  }
  return null
}

// ------------------------------------------------------------ 加载 client.js

const source = fs.readFileSync(clientPath, 'utf8')
const exportLine = '    module.exports = { name: PKG_ID, inject: inject, apply: apply }'
const internalsLine = '    module.exports = { name: PKG_ID, inject: inject, apply: apply, __internals: { createStore: createStore, createBackend: createBackend, createDecorator: createDecorator, createPageComponent: createPageComponent, createSettingsIconComponent: createSettingsIconComponent, workspaceMenuActions: workspaceMenuActions, STYLE_TEXT: STYLE_TEXT, formatCompact: formatCompact, formatInt: formatInt, isSafeColor: isSafeColor, ZH: ZH, EN: EN } }'
check('client.js has the expected export line', source.includes(exportLine))

let captured = null
const fakeWindow = { __ModuleLoader__: { load(definition) { captured = definition } } }
const moduleRequire = (spec) => {
  if (spec === 'react') return ReactMock
  throw new Error('unexpected require: ' + spec)
}
const factorySource = source.replace(exportLine, internalsLine)
new Function('window', 'require', factorySource)(fakeWindow, moduleRequire)
const exported = captured.factory(moduleRequire)
const internals = exported.__internals

check('module shape name', exported.name === '@local/workspace-toolkit')
check('inject list', Array.isArray(exported.inject) && exported.inject.join(',') === 'slots,locale,layout,contextMenus')
check('apply is exported', typeof exported.apply === 'function')
check('no sidebar.workspaces registration in client.js', source.indexOf('sidebar.workspaces') === -1)

// ------------------------------------------------------------ locale

const zh = internals.ZH
const en = internals.EN
const zhJson = JSON.parse(fs.readFileSync(zhPath, 'utf8'))
const enJson = JSON.parse(fs.readFileSync(enPath, 'utf8'))

const zhJsonKeys = Object.keys(zhJson).filter((key) => key !== 'meta')
const enJsonKeys = Object.keys(enJson).filter((key) => key !== 'meta')
check('locale json zh/en keys are paired', zhJsonKeys.join('|') === enJsonKeys.join('|'))
check('inline ZH/EN keys are paired', Object.keys(zh).join('|') === Object.keys(en).join('|'))
check('locale json carries every inline key', Object.keys(zh).every((key) => zhJson[key] !== undefined && enJson[key] !== undefined))

const usedKeys = new Set()
const keyRe = /\bt\('([a-zA-Z0-9_.]+)'/g
let keyMatch = keyRe.exec(source)
while (keyMatch) { usedKeys.add(keyMatch[1]); keyMatch = keyRe.exec(source) }
;['tokens.input', 'tokens.output', 'tokens.total', 'tokens.cacheRead', 'tokens.cacheWrite', 'tokens.reasoning', 'tokens.sessions'].forEach((key) => usedKeys.add(key))
const missingKeys = [...usedKeys].filter((key) => typeof zh[key] !== 'string' || typeof en[key] !== 'string')
check('all t() keys exist in zh and en', missingKeys.length === 0, missingKeys.join(','))

function makeT(dict) {
  return (key, params) => {
    const template = dict[key] === undefined ? key : dict[key]
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
}
const t = makeT(zh)

// ------------------------------------------------------------ fixture

const SNAPSHOT = {
  ok: true,
  version: 2,
  settings: { showSidebarEntry: true },
  workspaces: [
    {
      workspaceId: 'ws-a',
      path: '/tmp/a',
      title: '主项目',
      pinned: true,
      note: '核心',
      color: '#2fb67c',
      model: { provider: 'deepseek', model: 'deepseek-chat' },
      usage: { inputTokens: 800, outputTokens: 200, totalTokens: 1234, cacheReadTokens: 234, cacheWriteTokens: 0, reasoningTokens: 0, sessions: 3 },
      sessionCount: 3,
    },
    {
      workspaceId: 'ws-b',
      path: '/tmp/b',
      title: '旁支',
      pinned: false,
      note: '',
      color: '',
      model: null,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, sessions: 0 },
      sessionCount: 0,
    },
  ],
  models: {
    providers: [
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }, { id: 'deepseek-reasoner', name: 'DeepSeek R1' }] },
    ],
  },
  defaultModel: { provider: 'deepseek', model: 'deepseek-chat' },
  usageAt: '2026-11-11T06:00:00.000Z',
  customProviders: {
    available: true,
    entryId: 'llm-pi-ai',
    providers: [
      {
        route: 'co-claw',
        displayName: 'Co-Claw (公司 MaaS)',
        api: 'openai-completions',
        baseURL: 'https://maas.example.com/model-cop/co-claw/v1',
        headers: { 'X-UAC-APP-ID': '1234567890', 'X-Emp-No': '0000000000' },
        models: [{ id: 'co-claw', name: 'co-claw', contextWindow: 256000, maxTokens: 16384, input: ['text'] }],
        apiKeyEnv: 'CO_CLAW_API_KEY',
        apiKeyEnvExplicit: true,
        keyConfigured: true,
      },
    ],
  },
}

const snapshotResponse = () => ({ ok: true, status: 200, json: async () => SNAPSHOT })

function cloneJson(value) { return JSON.parse(JSON.stringify(value)) }

const fetchCalls = []
globalThis.fetch = async (url, options) => {
  const opts = options || {}
  const call = { url, options: opts }
  fetchCalls.push(call)
  const method = opts.method || 'GET'
  const body = opts.body ? JSON.parse(opts.body) : null
  call.body = body
  if (url.indexOf('/workspace-toolkit/providers/test') >= 0) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        route: body && body.route,
        url: 'https://example.test/v1/chat/completions',
        status: 200,
        latencyMs: 812,
        detail: 'model=DeepSeek-V4-Flash-0731',
      }),
    }
  }
  if (url.indexOf('/workspace-toolkit/providers') >= 0) {
    if (method === 'POST') {
      const patch = (body && body.patch) || {}
      const route = body && body.route
      if (patch.delete === true) {
        SNAPSHOT.customProviders.providers = SNAPSHOT.customProviders.providers.filter((provider) => provider.route !== route)
        return { ok: true, status: 200, json: async () => ({ ok: true, route, removed: true, customProviders: cloneJson(SNAPSHOT.customProviders) }) }
      }
      const providers = SNAPSHOT.customProviders.providers.slice()
      const index = providers.findIndex((provider) => provider.route === route)
      const merged = {
        route,
        displayName: patch.displayName || '',
        api: patch.api || 'openai-completions',
        baseURL: patch.baseURL || '',
        headers: cloneJson(patch.headers || {}),
        models: cloneJson(patch.models || []),
        apiKeyEnv: patch.apiKeyEnv || 'CO_CLAW_API_KEY',
        apiKeyEnvExplicit: true,
        keyConfigured: true,
      }
      if (index >= 0) providers[index] = merged
      else providers.push(merged)
      SNAPSHOT.customProviders.providers = providers
      return { ok: true, status: 200, json: async () => ({ ok: true, route, removed: false, customProviders: cloneJson(SNAPSHOT.customProviders) }) }
    }
    return { ok: true, status: 200, json: async () => cloneJson(SNAPSHOT.customProviders) }
  }
  return snapshotResponse()
}

// ------------------------------------------------------------ apply 生命周期

const doc = new FakeDocument()
globalThis.document = doc
globalThis.MutationObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle)

const registered = []
const injected = []
const cleanups = []
const menuRegistrations = []
const applyCtx = {
  effect(fn) {
    const cleanup = fn()
    cleanups.push(cleanup)
    return () => {}
  },
  locale: {
    register() { return () => {} },
    bind() { return t },
  },
  slots: {
    inject(name, callback) {
      injected.push(name)
      const disposer = callback()
      return disposer || (() => {})
    },
    register(options) {
      registered.push(options)
      return () => {}
    },
  },
  layout: { selectPanel() {} },
  contextMenus: {
    register(input) { menuRegistrations.push(input); return () => {} },
  },
}

exported.apply(applyCtx)

check('apply injects exactly 4 slots', injected.length === 4, injected.join(','))
check('apply injects the documented slots', injected.join(',') === 'settings.section,settings.section.icon,main,contextMenu.icon')
check('apply no longer injects sidebar.footer.action', injected.every((name) => name !== 'sidebar.footer.action'))
const registeredNames = registered.map((options) => options.name)
check('apply registers 3 slot entries', registered.length === 3, registeredNames.join(','))
check('no sidebar.workspaces registration', registeredNames.every((name) => name !== 'sidebar.workspaces'))
const sectionEntry = registered.find((options) => options.name === 'settings.section')
const mainEntry = registered.find((options) => options.name === 'main')
check('settings.section id/order', sectionEntry && sectionEntry.id === 'workspace-toolkit' && sectionEntry.order === 60)
check('main keyed slot', mainEntry && mainEntry.key === 'workspace-toolkit')
check('apply registers effects (ctx.effect used)', cleanups.length >= 3)

// ------------------------------------------------------------ 工作区右键菜单

await new Promise((resolve) => setTimeout(resolve, 0))
check('context menu registered once', menuRegistrations.length === 1)
const menuRegistration = menuRegistrations[0] || {}
check('context menu id/target/order', menuRegistration.id === 'workspace-toolkit.workspace-actions' && menuRegistration.target === 'workspace' && menuRegistration.order === 110)
const pinnedActions = typeof menuRegistration.resolve === 'function'
  ? menuRegistration.resolve({ workspaceId: 'ws-a', path: '/tmp/a', displayTitle: '主项目' })
  : []
const pinnedIds = pinnedActions.map((action) => action.id).join(',')
check('workspace menu returns pin + one config entry', pinnedIds === 'pin,config', pinnedIds)
check('pinned workspace pin action unpins', pinnedActions[0] && pinnedActions[0].label === '取消置顶' && pinnedActions[0].icon && pinnedActions[0].icon.key === 'workspace.unpin' && pinnedActions[0].separatorBefore === true)
check('config entry opens the panel', pinnedActions[1] && pinnedActions[1].label === '工作区配置' && pinnedActions[1].icon && pinnedActions[1].icon.key === 'workspace-toolkit.icon')
check('config entry has no color submenu', pinnedActions[1] && pinnedActions[1].children === undefined)
const noTargetActions = typeof menuRegistration.resolve === 'function' ? menuRegistration.resolve({ displayTitle: 'x' }) : null
check('workspace menu without workspaceId returns empty', Array.isArray(noTargetActions) && noTargetActions.length === 0)
const menuStore = internals.createStore()
menuStore.set({ phase: 'ready', error: '', snapshot: SNAPSHOT })
const menuBackend = { patchMeta: () => Promise.resolve(SNAPSHOT) }
const unpinnedActions = internals.workspaceMenuActions({}, menuStore, menuBackend, t, { workspaceId: 'ws-b' })
check('unpinned workspace pin action pins', unpinnedActions[0] && unpinnedActions[0].label === '置顶工作区' && unpinnedActions[0].icon.key === 'workspace.pin')

// ------------------------------------------------------------ backend

const store = internals.createStore()
const backend = internals.createBackend(applyCtx, store)

async function runBackendChecks() {
  await backend.refresh(true)
  check('snapshot refresh reads store', store.get().snapshot && store.get().snapshot.ok === true)
  check('snapshot usage url', fetchCalls.some((call) => call.url === '/workspace-toolkit/snapshot?usage=1'))
  const before = fetchCalls.length
  await backend.patchMeta('ws-a', { note: 'x' })
  const call = fetchCalls[before]
  const body = call && call.options && call.options.body ? JSON.parse(call.options.body) : null
  check('patchMeta posts /meta body', call.url === '/workspace-toolkit/meta' && body && body.workspaceId === 'ws-a' && body.patch.note === 'x')
  await backend.patchSettings({ showSidebarEntry: false })
  const settingsCall = fetchCalls[fetchCalls.length - 1]
  check('patchSettings posts /settings body', settingsCall.url === '/workspace-toolkit/settings' && JSON.parse(settingsCall.options.body).patch.showSidebarEntry === false)
  check('post response applies snapshot', store.get().snapshot && store.get().snapshot.ok === true)
}
await runBackendChecks()

store.set({ phase: 'ready', error: '', snapshot: SNAPSHOT })

// ------------------------------------------------------------ settings 页渲染

const decoratorStub = { expandAll() {}, collapseAll() {} }
const SettingsPage = internals.createPageComponent(applyCtx, store, backend, decoratorStub, 'settings')
const settingsHost = render(SettingsPage, { t }, doc)
const settingsText = settingsHost.textContent
check('settings page renders title', settingsText.includes('工作区工具箱'))
check('settings page renders workspace title', settingsText.includes('主项目'))
check('settings page renders note in parentheses', settingsText.includes('（核心）'))
check('settings page renders token chips', settingsText.includes('合计 1,234'))
check('settings page renders sessions chip', settingsText.includes('会话数 3'))
check('settings page renders model option', settingsText.includes('DeepSeek Chat'))
check('settings page no longer renders sidebar entry switch', settingsHost.querySelectorAll('[role="switch"]').length === 0 && !settingsText.includes('在左侧边栏显示'))
check('settings page renders color swatches', settingsHost.querySelectorAll('button[class*="wtk-swatch"]').length === 16)

// ------------------------------------------------------------ 自定义供应商 UI

await settle(10)
const providersCard = settingsHost.querySelector('[data-wtk-providers="true"]')
check('settings page renders providers card', providersCard !== null)
check('settings page renders provider row', settingsHost.querySelectorAll('[data-provider="co-claw"]').length === 1)
check('provider row shows display name + route', providersCard.textContent.includes('Co-Claw (公司 MaaS)') && providersCard.textContent.includes('co-claw'))
const keyDot = providersCard.querySelector('[data-on="true"]')
check('provider key dot reflects configured key', keyDot !== null && (keyDot.getAttribute('title') || '').indexOf('CO_CLAW_API_KEY') >= 0)
check('provider row shows models count and api chip', providersCard.textContent.includes('1 个模型') && providersCard.textContent.includes('OpenAI Chat Completions'))

let providerBlock = settingsHost.querySelector('[data-provider="co-claw"]')
providerBlock.querySelector('[data-provider-edit="true"]').click()
await settle(4)
providerBlock = settingsHost.querySelector('[data-provider="co-claw"]')
check('edit opens inline provider form', providerBlock.querySelector('[data-wtk-provider-form="true"]') !== null)
check('form renders header rows from snapshot', providerBlock.querySelectorAll('[data-provider-header-row="true"]').length === 2)
check('form renders model row from snapshot', providerBlock.querySelectorAll('[data-provider-model-row="true"]').length === 1)
const routeInput = providerBlock.querySelector('[data-provider-field="route"]')
check('route input is locked while editing', routeInput && routeInput.getAttribute('disabled') !== null)
const beforeProviders = fetchCalls.length
providerBlock.querySelector('[data-provider-add-header="true"]').click()
await settle(3)
providerBlock = settingsHost.querySelector('[data-provider="co-claw"]')
check('adding header row grows form', providerBlock.querySelectorAll('[data-provider-header-row="true"]').length === 3)
providerBlock.querySelector('[data-provider-save="true"]').click()
await settle(8)
const saveCalls = fetchCalls.slice(beforeProviders).filter((call) => call.url === '/workspace-toolkit/providers' && call.options.method === 'POST')
const saveCall = saveCalls[0]
check('save posts /providers exactly once', saveCalls.length === 1)
check('save body has route and patch headers/models', !!saveCall && saveCall.body.route === 'co-claw' && saveCall.body.patch.headers['X-Emp-No'] === '0000000000' && saveCall.body.patch.headers['X-UAC-APP-ID'] === '1234567890' && saveCall.body.patch.models[0].id === 'co-claw' && saveCall.body.patch.models[0].contextWindow === 256000)
check('save feedback shown', settingsHost.textContent.includes('已保存，模型目录稍后刷新'))

providerBlock = settingsHost.querySelector('[data-provider="co-claw"]')
const beforeTest = fetchCalls.length
providerBlock.querySelector('[data-provider-test="true"]').click()
await settle(8)
const testCall = fetchCalls.slice(beforeTest).find((call) => call.url === '/workspace-toolkit/providers/test')
check('test posts /providers/test with first model', !!testCall && testCall.body.route === 'co-claw' && testCall.body.model === 'co-claw')
check('test renders detail line', settingsHost.textContent.includes('HTTP 200 · 812ms · model=DeepSeek-V4-Flash-0731'))

providerBlock = settingsHost.querySelector('[data-provider="co-claw"]')
providerBlock.querySelector('[data-provider-delete="true"]').click()
await settle(3)
providerBlock = settingsHost.querySelector('[data-provider="co-claw"]')
check('delete asks for inline confirmation', providerBlock.querySelector('[data-provider-confirm-delete="true"]') !== null && providerBlock.querySelector('[data-provider-delete="true"]') === null)
const beforeDelete = fetchCalls.length
providerBlock.querySelector('[data-provider-confirm-delete="true"]').click()
await settle(8)
const deleteCall = fetchCalls.slice(beforeDelete).find((call) => call.url === '/workspace-toolkit/providers' && call.options.method === 'POST')
check('delete posts patch.delete=true', !!deleteCall && deleteCall.body.route === 'co-claw' && deleteCall.body.patch.delete === true)
check('delete feedback + row removed', settingsHost.textContent.includes('已删除，模型目录稍后刷新') && settingsHost.querySelectorAll('[data-provider="co-claw"]').length === 0)

const beforeInvalid = fetchCalls.length
settingsHost.querySelector('[data-provider-add="true"]').click()
await settle(3)
const newForm = settingsHost.querySelector('[data-wtk-provider-form="true"]')
check('add provider opens empty form', newForm !== null && newForm.querySelectorAll('[data-provider-model-row="true"]').length === 1)
newForm.querySelector('[data-provider-save="true"]').click()
await settle(3)
const invalidPosts = fetchCalls.slice(beforeInvalid).filter((call) => call.url === '/workspace-toolkit/providers' && call.options.method === 'POST').length
check('invalid form blocks request and shows validation', invalidPosts === 0 && settingsHost.textContent.indexOf('请填写合法的供应商 ID') >= 0)

SNAPSHOT.customProviders = { available: false, entryId: 'llm-pi-ai', providers: [] }
store.set({ phase: 'ready', error: '', snapshot: SNAPSHOT })
await settle(6)
check('unavailable provider UI renders disabled notice', settingsHost.textContent.includes('当前宿主未提供 configEditor 服务') && settingsHost.querySelector('[data-provider-add="true"]') === null)

// ------------------------------------------------------------ overview 页渲染

const OverviewPage = internals.createPageComponent(applyCtx, store, backend, decoratorStub, 'overview')
const overviewHost = render(OverviewPage, { t }, doc)
const overviewText = overviewHost.textContent
check('overview page renders summary', overviewText.includes('全局汇总'))
check('overview page renders compact total', overviewText.includes('1.2k'))
check('overview page renders model cell', overviewText.includes('deepseek/deepseek-chat'))
check('overview page renders table total row', overviewText.includes('合计'))
check('overview page renders refresh button', findButtonByText(overviewHost, '刷新') !== null)
const expandButton = findButtonByText(overviewHost, '展开全部')
const collapseButton = findButtonByText(overviewHost, '收起全部')
check('overview page renders expand/collapse buttons', expandButton !== null && collapseButton !== null)
check('overview page renders workspace settings rows', overviewHost.querySelectorAll('[data-wtk-ws]').length === 2)
check('overview page renders focusable note input', overviewHost.querySelectorAll('[data-wtk-field="note"]').length === 2)
check('overview page renders focusable model select', overviewHost.querySelectorAll('[data-wtk-field="model"]').length === 2)
check('panel fills native main area with its own scroller', overviewHost.querySelectorAll('[class*="wtk-root"]').length === 1 && overviewHost.querySelectorAll('[class*="wtk-scroll"]').length === 1)
check('settings page host does not constrain height', settingsHost.querySelector('[class*="wtk-root"]').getAttribute('data-inline') === 'true')

let expandCalls = 0
let collapseCalls = 0
decoratorStub.expandAll = () => { expandCalls += 1 }
decoratorStub.collapseAll = () => { collapseCalls += 1 }
{
  const host = render(OverviewPage, { t }, doc)
  const button = findButtonByText(host, '展开全部')
  if (button) button.click()
  check('overview expand button calls decorator', expandCalls === 1)
  const collapse = findButtonByText(host, '收起全部')
  if (collapse) collapse.click()
  check('overview collapse button calls decorator', collapseCalls === 1)
}

// ------------------------------------------------------------ 空数据降级

const emptySnapshot = Object.assign({}, SNAPSHOT, { workspaces: [], usageAt: null })
store.set({ phase: 'ready', error: '', snapshot: emptySnapshot })
const emptySettings = render(SettingsPage, { t }, doc)
check('settings empty state', emptySettings.textContent.includes('还没有工作区。'))
const emptyOverview = render(OverviewPage, { t }, doc)
check('overview empty state', emptyOverview.textContent.includes('还没有工作区。'))

// ------------------------------------------------------------ 设置图标

const SettingsIcon = internals.createSettingsIconComponent()
{
  const host = render(SettingsIcon, { size: 16, active: true }, doc)
  check('settings icon renders svg', host.querySelectorAll('svg').length === 1)
}

// ------------------------------------------------------------ 装饰层（假原生树）

const nativeDoc = new FakeDocument()
const nativeRows = {}
const clickCounts = {}
const listArea = nativeDoc.createElement('div')
listArea.setAttribute('class', 'NSkPbW_listArea')
const header = nativeDoc.createElement('div')
header.setAttribute('class', 'NSkPbW_sectionHeader')
const headerActions = nativeDoc.createElement('span')
headerActions.setAttribute('class', 'NSkPbW_headerActions')
header.appendChild(headerActions)
listArea.appendChild(header)
const group = nativeDoc.createElement('div')
group.setAttribute('class', 'NSkPbW_groupSection')
listArea.appendChild(group)

function makeRow(id, expanded) {
  const row = nativeDoc.createElement('div')
  row.setAttribute('role', 'treeitem')
  row.setAttribute('data-row-key', 'workspace:' + id)
  row.setAttribute('class', 'wh7htW_projectRow')
  row.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  row.__onclick = () => {
    clickCounts[id] = (clickCounts[id] || 0) + 1
    row.setAttribute('aria-expanded', row.getAttribute('aria-expanded') === 'true' ? 'false' : 'true')
  }
  const projectText = nativeDoc.createElement('span')
  projectText.setAttribute('class', 'wh7htW_projectText')
  const title = nativeDoc.createElement('span')
  title.setAttribute('class', 'wh7htW_title')
  title.textContent = 'Workspace ' + id
  projectText.appendChild(title)
  const actions = nativeDoc.createElement('span')
  actions.setAttribute('class', 'wh7htW_rowActions')
  row.appendChild(projectText)
  row.appendChild(actions)
  group.appendChild(row)
  nativeRows[id] = row
  return row
}

makeRow('ws-a', true)
makeRow('ws-b', false)
nativeDoc.body.appendChild(listArea)

const reportCalls = []
const decoStore = internals.createStore()
decoStore.set({ phase: 'ready', error: '', snapshot: SNAPSHOT })
const decoBackend = { refresh: async () => SNAPSHOT }
const decorator = internals.createDecorator({}, decoStore, decoBackend, t, (label, error) => reportCalls.push(label), nativeDoc)

function spansFor(id) {
  return nativeRows[id].querySelectorAll('[data-wtk]')
}

decorator.decorateNow()
check('decorator appends pin span for pinned workspace', nativeRows['ws-a'].querySelectorAll('span[data-wtk="pin"]').length === 1)
check('decorator pin span has svg and title', nativeRows['ws-a'].querySelector('span[data-wtk="pin"]').querySelectorAll('svg').length === 1 && nativeRows['ws-a'].querySelector('span[data-wtk="pin"]').getAttribute('title') === '已置顶')
check('decorator appends note span', nativeRows['ws-a'].querySelectorAll('span[data-wtk="note"]').length === 1)
check('decorator note text', nativeRows['ws-a'].querySelector('span[data-wtk="note"]').textContent === '（核心）')
check('decorator never appends tokens span', nativeRows['ws-a'].querySelectorAll('span[data-wtk="tokens"]').length === 0)
check('decorator appends model span', nativeRows['ws-a'].querySelector('span[data-wtk="model"]').textContent === 'deepseek-ch…')
const decoKinds = nativeRows['ws-a'].querySelectorAll('[data-wtk]').map((node) => node.getAttribute('data-wtk')).join(',')
check('decorator order pin→note→model', decoKinds === 'pin,note,model', decoKinds)
check('decorator has no token chip style', !internals.STYLE_TEXT.includes('span[data-wtk="tokens"]{'))
check('decorator pin style present', internals.STYLE_TEXT.includes('span[data-wtk="pin"]{'))
check('decorator adds toggle-all button', header.querySelectorAll('button[data-wtk="toggle-all"]').length === 1)
check('decorator leaves empty row untouched', spansFor('ws-b').length === 0)
const styleTag = nativeDoc.querySelectorAll('style[data-wtk="styles"]')
check('decorator owns one style tag', styleTag.length === 1)
check('decorator color rule for ws-a', ((styleTag[0] && styleTag[0].textContent) || '').includes('[data-row-key="workspace:ws-a"] [class*="_title"]{color:#2fb67c;}'))
check('decorator no duplicate color rule', ((styleTag[0] && styleTag[0].textContent) || '').split('workspace:ws-a').length === 2)

decorator.decorateNow()
check('decorate twice keeps 3 spans', spansFor('ws-a').length === 3)
check('decorate twice keeps one toggle button', header.querySelectorAll('button[data-wtk="toggle-all"]').length === 1)

decoStore.set({
  phase: 'ready',
  error: '',
  snapshot: Object.assign({}, SNAPSHOT, {
    workspaces: [Object.assign({}, SNAPSHOT.workspaces[0], { note: '新核心' }), Object.assign({}, SNAPSHOT.workspaces[1], { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, sessions: 1 } })],
  }),
})
decorator.decorateNow()
check('decorator updates note text in place', nativeRows['ws-a'].querySelector('span[data-wtk="note"]').textContent === '（新核心）')
check('decorator keeps no tokens span after usage update', nativeRows['ws-b'].querySelectorAll('span[data-wtk="tokens"]').length === 0)
check('decorator still 3 spans after update', spansFor('ws-a').length === 3)
check('decorator still one color rule', nativeDoc.querySelector('style[data-wtk="styles"]').textContent.split('workspace:ws-a').length === 2)

decoStore.set({
  phase: 'ready',
  error: '',
  snapshot: Object.assign({}, SNAPSHOT, {
    workspaces: [Object.assign({}, SNAPSHOT.workspaces[0], { note: '', color: '', model: null, pinned: false, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, sessions: 0 } }), SNAPSHOT.workspaces[1]],
  }),
})
decorator.decorateNow()
check('decorator removes cleared spans', spansFor('ws-a').length === 0)
check('decorator clears color rules', nativeDoc.querySelector('style[data-wtk="styles"]').textContent === '')

// 恢复数据后测试 toggle-all：ws-b 处于收起状态，点击应只展开 ws-b
decoStore.set({ phase: 'ready', error: '', snapshot: SNAPSHOT })
decorator.decorateNow()
const toggleButton = header.querySelector('button[data-wtk="toggle-all"]')
check('toggle-all aria-label expand', toggleButton.getAttribute('aria-label') === '展开全部工作区')
// 图标必须是两个同向 chevron（同向才不会在 16px 下看成叉号 ✕）
const expandPaths = toggleButton.querySelectorAll('path').map((node) => node.getAttribute('d'))
check('toggle-all expand icon has two chevrons', expandPaths.length === 2)
check('toggle-all expand chevrons point the same way', expandPaths.every((d) => d.includes('l3.4-3.4')))
toggleButton.click()
check('toggle-all clicks only collapsed row', clickCounts['ws-b'] === 1 && !clickCounts['ws-a'])
check('toggle-all expanded ws-b', nativeRows['ws-b'].getAttribute('aria-expanded') === 'true')
decorator.decorateNow()
const toggleButton2 = header.querySelector('button[data-wtk="toggle-all"]')
check('toggle-all aria-label collapse', toggleButton2.getAttribute('aria-label') === '收起全部工作区')
const collapsePaths = toggleButton2.querySelectorAll('path').map((node) => node.getAttribute('d'))
check('toggle-all collapse chevrons point the same way', collapsePaths.length === 2 && collapsePaths.every((d) => d.includes('l3.4 3.4')))
toggleButton2.click()
check('toggle-all collapses both rows', nativeRows['ws-a'].getAttribute('aria-expanded') === 'false' && nativeRows['ws-b'].getAttribute('aria-expanded') === 'false')

decorator.dispose()
check('decorator dispose removes own nodes', nativeDoc.querySelectorAll('[data-wtk]').length === 0)
check('decorator dispose clears style tag', nativeDoc.querySelectorAll('style[data-wtk="styles"]').length === 0)

// ------------------------------------------------------------ 清理

cleanups.forEach((cleanup) => { if (typeof cleanup === 'function') cleanup() })
effectCleanups.forEach((cleanup) => { if (typeof cleanup === 'function') cleanup() })
delete globalThis.document
delete globalThis.MutationObserver
delete globalThis.requestAnimationFrame
delete globalThis.cancelAnimationFrame
delete globalThis.fetch

// ------------------------------------------------------------ 输出

console.log('')
console.log(checks.filter((item) => !item.ok).length === 0 ? 'RESULT: ALL CLIENT CHECKS PASSED' : 'RESULT: CLIENT CHECKS FAILED')
console.log(`${checks.length} checks, failed ${failed}`)
process.exitCode = failed === 0 ? 0 : 1
