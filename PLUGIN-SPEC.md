# workspace-toolkit 插件实现规格（Lead 定稿，唯一契约来源）

包：`@local/workspace-toolkit`，目录 `~/dsh-workspace-toolkit-plugin`
目标 profile：`web`（DSH_PROFILE=web，DSH_PROFILE_DIR=~/.dsh/profiles/web）

## 0. 需求（用户原话要点，不可偏离）
1. 为**单个工作区**配置模型；默认全部使用「当前使用的模型」；可手动配置为其他厂商模型或自定义模型。
2. 按工作区汇总模型 Token 用量。
3. 往左侧工作区区域**追加**元素：工作区标题右侧「展开/收起全部」图标按钮；每个工作区可置顶；工作区标题备注（原标题后括号展示）；工作区名称字体颜色。**不要改变或者重写 dsh 原有的元素和功能。**
4. 设置界面和左侧边栏都有本插件入口，侧边栏入口是否显示可在设置界面配置。

## 1. 硬性约束
- **禁止**注册 `sidebar.workspaces`（它在单槽里会整体替换原生工作区浏览器；本版本原生浏览器功能极多：搜索/分组/树/置顶/拖拽/归档/水印/快捷键等，重写必然回退）。禁止注册 `sidebar`（整体替换导航列）。
- 原生侧边栏的 React 树不改；只允许**追加式** DOM 装饰：向原生节点**内部 appendChild 自己创建的节点**、给自己创建的 `<style>` 打标记、读取原生节点属性。不改原生节点的 class/子节点顺序/其他属性。
- 客户端模块**不得 import** 任何 `@deepseek-ai/dsh-client-*` 包；只能通过 factory 的 `require` 拿 `react`、`react/jsx-runtime`，以及通过注入的 service（slots/locale/workspaces/sessions/uiWorkspace/layout）工作；`require` 若失败要 try/catch 降级。
- 可见文案全部走 `ctx.locale`（ns `workspace-toolkit`，zh + en 两份 `locale/*.json`），不得硬编码中文。
- 样式只用主题 token（`--dsw-alias-*`、`--dsw-radius-*`、`--dsw-specific-*`），自建样式放进 `<style data-plugin-css="@local/workspace-toolkit/styles">`，卸载时移除。
- 所有订阅/observer/timer/节点都必须在 `ctx.effect` 里登记 cleanup；卸载后页面不留任何本插件节点（`[data-wtk]`）。
- 客户端模块形态（沿用现有文件）：`window.__ModuleLoader__.load({ id: '@local/workspace-toolkit', factory: (require) => module })`；导出 `inject` 数组与 `apply(ctx)`。

## 2. 已验证的运行时事实（2026-11-11 从 asar 源码实读，可作为事实使用）
- **模型**：Agent 实例成员 `agent.model` 是 `AgentModel`（dsh-agent-loop `lib/index.js:545` `this.model = new AgentModel(...)`）。API：`current(): ModelSelection | undefined`、`select(selection)` —— `select` 会 `session.append('model/selection', {provider, model, reasoningEffort?})`（durable 事件，投影 `modelSelection` 的 `pending`，下一步请求即生效）。`model/selection` 在 `KNOWN_SESSION_EVENT_TYPES` 内。
- **agent/created**（serial，`await` 完成后才创建完成，第一个请求前可改模型）：`payload = { agent, source: 'startup'|'resume'|'clear'|'compact', signal? }`。
- **Token 用量**：session 日志事件 `assistant/message` 的 `data.usage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }`（实测 seq 样本；`totalTokens` = input+cacheRead+output）。`assistant/message` 的 `data` 是 `{turn, step, message, usage, stream}`。
- **工作区顺序**：`ctx.workspaceRegistry.insertBefore(id, beforeId?)` —— DOM insertBefore 语义，无 anchor 即追加到末尾；返回完整提交后的 `WorkspaceId[]`；持久化（durable display order），原生浏览器按它渲染 → 这就是「置顶」的正解。
- **workspaceRegistry**：`list(): Workspace[]`（含 id/path/title/createdAt/updatedAt/sessionIds）、`get(id)`、`create({path,title})`、`rename`、`delete`、`insertBefore`、`resolveByPath`。
- **sessionQuery**：`listSessions(signal?)`、`observeSession(sessionId, options?)` → `{events, cursor, inheritedEventCount}`、`readSession`、`readTitle`。
- **llm**：`listProviders(): LlmProviderInfo[]`（`{id, name, ...}`）、`listModels(provider): LlmModelInfo[]`（`{id, name, description?, contextWindow?}`）。
- **agentDefaultModel**：`currentSelection(): ModelSelection`（= 用户当前使用的全局默认模型，用于「默认都使用当前模型」）。
- **Client slots**：`ctx.slots.inject(ownerKey, callback)`（ownerKey 用 slot 名）；`ctx.slots.register({ name, id, order, priority?, label?, locale? }, Component)`。可用于本插件的槽：`sidebar.footer.action`(list)、`settings.section`(list) + `settings.section.icon`(list，按 section id 匹配)、`main`(keyed，`key: 'workspace-toolkit'`，配合 `ctx.layout.selectPanel(id)` 打开)。
- **Client service**：`layout.selectPanel(id)`、`uiWorkspace.openSession/openWorkspace/startSession/pickDirectory/listDirectory/createDirectory`、`workspaces.rename/delete/insertBefore`、`sessions.*`、`locale.bind(ns)`。
- **原生工作区浏览器 DOM**（本版本 client.js 行号）：工作区行 = `div[role="treeitem"][data-row-key="workspace:<workspaceId>"]`，class 含 `*_projectRow`；其内 `span[class*="_projectText"] > span[class*="_title"]`（标题文本），再后面 `span[class*="_rowActions"]`；行内 `aria-expanded="true|false"` 表示展开状态；**点整行 = 切换展开/收起**（React onClick `onToggle`）。分组容器 `div[class*="_groupSection"]`；列表 `div[class*="_list"]`（块容器，非 flex）；区块头 `div[class*="_sectionHeader"]`（height:36px，flex，justify-content:flex-end，内含 searchSlot 与 headerActions）。
  - 注意：`group.key` 对真实工作区就是 `workspaceId`（ungrouped 为空串 ""）。类名带 hash 前缀（`wh7htW_`、`NSkPbW_`），**必须用 `[class*="xxx"]` 前缀片段匹配，不要硬编码 hash**。
  - `workspaceRegistry` 与原生浏览器的顺序同源，所以置顶通过 host 改顺序后，浏览器刷新/轮询即按新顺序渲染（必要时可 dispatch `visibilitychange` 或等下次 follow 帧，注意别硬刷新页面）。

## 3. Host 契约（index.js 实现，客户端按此消费）
所有路由同源，前缀 `/workspace-toolkit`（沿用旧实现，`ctx.webServer.register({kind:'exact', path, handler})`）。

### GET /workspace-toolkit/snapshot[?usage=1]
不带参数只返回工作区元数据（不扫会话日志，`usage` 全零、`usageAt` 为 `null`）；带 `?usage=1` 才统计一次 Token 用量并缓存，后续不带参数的快照复用该缓存。
```json
{
  "ok": true,
  "version": 2,
  "settings": { "showSidebarEntry": true },
  "workspaces": [
    {
      "workspaceId": "ws_...",
      "path": "/abs/path",
      "title": "名称",
      "pinned": false,
      "note": "",
      "color": "",
      "model": { "provider": "deepseek-official", "model": "deepseek-flash", "reasoningEffort": "..." },
      "usage": { "inputTokens": 0, "outputTokens": 0, "totalTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "reasoningTokens": 0, "sessions": 0 },
      "sessionCount": 0
    }
  ],
  "models": { "providers": [ { "id": "...", "name": "...", "models": [ { "id": "...", "name": "...", "description": "" } ] } ] },
  "defaultModel": { "provider": "...", "model": "..." },
  "usageAt": "ISO"
}
```
- `workspace[]` 顺序 = `workspaceRegistry.list()` 顺序（已含置顶效果）。
- `model` 为 `null` 表示「跟随当前模型」。
- `color` 为空串表示默认色；非空为 CSS 颜色字符串（`#rgb`/`rgb()`/`hsl()` 或主题 token 名，host 侧做白名单校验，只允许 `#hex`、`rgb()/rgba()/hsl()/hsla()`、`var(--dsw-*)`）。

### POST /workspace-toolkit/meta
body: `{ "workspaceId": "...", "patch": { "note"?: string, "color"?: string, "model"?: object|null, "pinned"?: boolean } }`
- 支持批量 `{ "items": [{ "workspaceId", "patch" }, ...] }`。
- `pinned: true` → host 用 `insertBefore(wsId, 当前第一个非置顶工作区id)` 把该工作区移到所有置顶块末尾/最前（实现要求：**幂等**，重复置顶不改变相对顺序；置顶集合整体在最前，保持置顶顺序）；`pinned: false` → 按 `insertBefore` 移到置顶块之后。
- 返回最新 snapshot。

### POST /workspace-toolkit/settings
body: `{ "patch": { "showSidebarEntry": boolean } }` → 返回 snapshot。

### GET /workspace-toolkit/client-report  → `{ ok, report }`（客户端注册/装饰失败上报，用于无浏览器时诊断）
### POST /workspace-toolkit/client-report → body `{ applied: boolean, errors: [{label, message}], href, at }`，只保留最近 1 条
### GET /workspace-toolkit/ping → `{ ok, store, workspaceCount, metaCount, modelProviders, decorated? }`（诊断用）

### 模型应用规则（`ctx.on('agent/created')`）
- 新 Agent 的 `agent.model` 与 `agent.session` 不存在 → 跳过。
- 子代理（`session.header.origin === 'subagent'` 或 `header.parentSession`）→ 跳过（继承父）。
- 仅 `payload.source === 'startup'`；`agent.session.requestHeader() !== undefined` 或 `ownEvents()` 里已有 `model/selection` → 跳过（尊重用户已有选择）。
- 按 `normalizePath(header.cwd)` 匹配工作区（同时兼容 `workspace.path` 与 `resolveByPath`）；该工作区 `model` 为 null → 不动（= 跟随当前模型）。
- 有配置 → `agent.model.select({provider, model, reasoningEffort?})`，成功/失败都 `log`。

## 4. 客户端实现要求
### 4.1 槽位注册（4 处，全部 lazy + 包 try/catch 上报）
1. `sidebar.footer.action`，id `workspace-toolkit-entry`，order 90，label 走 locale；**仅当 `settings.showSidebarEntry === true` 才渲染**（否则返回 null/不注册；随 snapshot 轮询更新）。图标用内联 SVG（16px，currentColor），点击 `ctx.layout.selectPanel('workspace-toolkit')`。
2. `settings.section`，id `workspace-toolkit`，order 60，标题「工作区模型与用量」；内含：侧边栏入口开关（写 `/settings`）、每工作区：模型选择（下拉：跟随当前模型 / 各 provider+model / 自定义输入 provider+model）、备注输入、颜色（颜色 input + 预设色块）、置顶开关、Token 用量（input/output/total/cache/reasoning + 会话数）、「打开总览面板」按钮。
3. `settings.section.icon`，id `workspace-toolkit`，order 60，自绘 SVG（与 icon.svg 同源）。
4. `main`（keyed，`key: 'workspace-toolkit'`），总览面板：全部工作区表格（名称/路径/模型/置顶/备注/颜色/会话数/totalTokens，可排序或直接按 registry 顺序）、全局汇总（总 token、按 provider/model 汇总可选）、「全部展开/收起」（调用装饰器方法）、刷新 + 最后更新时间。

### 4.2 原生侧边栏装饰层（核心，独立在 client.js 内名为 `createDecorator(ctx, ...)`）
- 数据：不轮询。挂载时与 `visibilitychange` 变为可见时各取一次元数据快照；Token 用量只在打开设置页 / 总览面板时以 `?usage=1` 计算一次。
- 装饰对象：`[role="treeitem"][data-row-key^="workspace:"]`（工作区行）与 `[class*="_sectionHeader"]`（区块头）。
- 对每个工作区行：
  - 若 `note` 非空 → 在 `[class*="_projectText"]` 内 `.title` **之后** append `<span data-wtk="note">`，文案 `（note）`，样式：12px、`--dsw-alias-label-tertiary`、ellipsis、不换行。
  - 有 `model` 配置时追加 `<span data-wtk="model">` 显示 `model.model`（若太长截断 12 字符）；无配置不渲染（跟随当前模型）。
  - 颜色：**不写行内样式到原生节点**，而是把 `[data-row-key="workspace:<id>"] [class*="_title"]{color:<color>}` 规则写进自建 `<style data-wtk="styles">`（每次数据更新重算全部规则）。
  - 幂等：装饰前先查询 `[data-wtk]` 是否已存在（用 `[data-wtk-for="<workspaceId>"]` 归属标记），已存在则只更新文本，不重复 append。
- 区块头「展开/收起全部」按钮：append 到 `[class*="_sectionHeader"]` 末尾（headerActions 之后），自建 `button[data-wtk="toggle-all"]`，28×28，`aria-label` 走 locale，用 SVG（全展开/全收起两态可切换，或点击时先判定当前状态）。点击逻辑：取所有 `[role="treeitem"][data-row-key^="workspace:"]`，若存在 `aria-expanded="false"` → 目标=全部展开（只点那些 false 的）；否则目标=全部收起（只点 true 的）；逐个 `row.click()`。点击前给标记防止自己的 MutationObserver 反复执行。
- 同步机制：`MutationObserver` 观察 `.NSkPbW_list` 祖先（用 `[class*="_listArea"]`）的 `childList` + `subtree`，以及 workspace 行的 `aria-expanded` 属性；用 `requestAnimationFrame` 合并（一帧最多一次）。注意避免自触发死循环：装饰函数只 append 缺失节点、只在文本变化时写 textContent；不删除/重排原生节点。
- 卸载：断开 observer、移除全部 `[data-wtk]` 节点与自建 style、恢复（无需恢复原生属性，因为未改动）。
- 若 3 秒内找不到原生容器 → 上报 `/client-report`（label `decorator:no-container`）并停止重试（避免刷屏），但保留 30s 后一次重探。

### 4.3 交互
- 置顶：面板里 switch → POST /meta {pinned}；成功后刷新 snapshot 并提示（无需刷新页面，原生浏览器下次 follow 帧刷新；若 2s 内顺序未变可 `location.reload()` 兜底 **仅在用户点击「立即应用顺序」时**）。
- 总览面板顶部显示「最后更新」，提供刷新按钮（GET `?usage=1`）。
- 所有文案 locale：`locale/zh.json`、`locale/en.json`（key 见现有文件，可新增）。

## 5. 测试（node 直接跑，无浏览器）
- `node --check index.js && node --check client.js` 必过。
- `node test/host-contract.test.mjs`：mock ctx（webServer/workspaceRegistry/sessionQuery/llm/storage），覆盖 snapshot 形状、meta 批量、pinned 调 insertBefore、settings 开关、agent/created 五条跳过规则 + 正常应用、usage 分桶。
- `node test/client-render.test.mjs`：极简 React mock 渲染 settings.section / main 面板 / 空数据不崩；可用假 DOM（自写 30 行的 fake element 支持 appendChild/querySelector 到 class 片段）验证装饰器幂等（两次 decorate 不产生重复节点）与颜色样式规则生成。
- 不要求真实浏览器截图；不要写 mock 预览服务器。

## 6. 分工与文件所有权
- Lead：`index.js`、`test/host-contract.test.mjs`、`cordis.patch.yml`、`package.json`、安装与线上验证。
- client-ui：`client.js`、`locale/zh.json`、`locale/en.json`、`icon.svg`（如需要）、`test/client-render.test.mjs`。
- 不改对方的文件；契约变更先找 Lead。

## 7. 修订记录

### v2.1.0（用户第二轮反馈后）

- **新增**：原生工作区气泡菜单入口。使用官方 `contextMenus` 服务
  `ctx.contextMenus.register({ id: 'workspace-toolkit.workspace-actions', target: 'workspace', order: 110, resolve })`，
  条目 pin（复用原生图标 `workspace.pin`/`workspace.unpin`）、note、color（子菜单：默认 + 8 色块）、model。
  `resolve` 收到扁平 target `{ workspaceId, path, displayTitle }`（与原生 `workspace.rename`/`workspace.delete` 一致）。
- **新增**：`contextMenu.icon` keyed 槽注册三个自绘图标（note/color/model），key 形如 `workspace-toolkit.note`。
- **新增**：模块级 `focusChannel` + `useFocusEffect`，菜单跳转面板后滚动到工作区块、1.2s 高亮、聚焦
  `[data-wtk-field="note|color|model"]`。
- **变更**：置顶可见性。装饰层新增 `span[data-wtk="pin"]`（品牌色 12px 图钉，`title` 取 `t('pinned')`），
  `DECO_ORDER = { pin: 0, note: 1, tokens: 2, model: 3 }`；修复 `DECO_ORDER[kind] || 99` 把 0 当假值导致 pin 排最后的 bug。
- **变更**：Token 总量改为 chip（`span[data-wtk="tokens"]` 圆角标签 + `wtk-deco-tokens` 类）。
- **移除**：`sidebar.footer.action` 注册与设置页 `showSidebarEntry` 开关（用户要求只保留设置页入口）。
- **包变更**：`dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-context-menu`，`inject` 增加 `contextMenus`；
  version → 2.1.0。
- **测试**：client-render 84 checks failed 0（含菜单 action 字段、pinned 装饰、chip 类、footer.action 不注册）。
- **变更**：去掉侧边栏工作区标题旁的 Token 标签与 20s 快照轮询。装饰层只保留 pin / note / model，
  `DECO_ORDER = { pin: 0, note: 1, model: 2 }`；host 的 `?force=1` 改为 `?usage=1`，
  Token 用量只在打开设置页 / 总览面板时计算一次并缓存，其余快照不扫会话日志。

### v2.1.1（颜色块反馈）

- **变更**：工作区菜单的「设置标题颜色」子菜单不再以 `#rrggbb` 文本作为 label；
  改为本地化颜色名（`swatch.blue|green|amber|red|violet|cyan|pink|gray`）+ **矩形色块图标**
  （`contextMenu.icon` 槽按 `workspace-toolkit.swatch.<0..7>` 注册 8 个色块组件，
  `workspace-toolkit.swatch.reset` 为「默认颜色」虚线方块）。
- **变更**：面板颜色区改为「矩形色块行（22×22，圆角 5px，`aria-pressed`）+ 默认颜色按钮」优先，
  自定义色值输入框降级为第二行「自定义色值（可选）」。
- **测试**：client-render 86 checks failed 0（新增断言：颜色子菜单项 label 不含 `#`、icon key 前缀正确、8 个颜色名顺序）。

### v2.1.2（面板滚动与居中反馈）

- **修复**：main keyed 槽的容器 `MainPanel`（ui-layout `AppFrame_module_css_default.mainPanel`）是
  `display:flex;flex-direction:column;flex:1;min-width:0;min-height:0`，外层 `centerCol` 是
  `overflow:hidden`。插件页面此前没有撑满高度、也没有自己的滚动容器，导致内容被裁掉且无法滚动。
  现在 `createPageComponent` 统一包一层 `.wtk-root`（`flex:1 1 auto;min-height:0;height:100%;overflow:hidden`）
  + `.wtk-scroll`（`flex:1 1 auto;min-height:0;overflow-y:auto;padding:20px 24px 40px`），
  内层 `.wtk-page` 改为 `width:100%;max-width:880px;margin:0 auto` 居中。
- **设置页**（settings.section）里不做高度约束：`data-inline="true"` 时 root 改为 `height:auto;overflow:visible`，
  滚动交给设置页自己的容器。
- **测试**：client-render 86 checks failed 0（新增/沿用断言中页面根节点类名为 `wtk-root`）。

### v2.1.3（新建工作区后置顶失效）

- **根因**：`dsh-workspace` 的 `create()` 明确「A newly created workspace is **prepended** to the durable registry
  order.」→ 每新建一个工作区，它都会排到队首，把置顶工作区挤到第二位。此前只有插件启动时
  `pinner.reconcile()` 校正一次，运行期不再校正。
- **修复（host 两路兜底）**：
  1. `ctx.get('workspaceController').follow(signal)` 监听帧（`order` / `upsert` / `remove`），
     250ms 防抖后调用 `pinner.reconcile()`；效果流由 `ctx.effect` 管理，卸载时 abort + 清定时器。
  2. `buildSnapshot()` 在读取注册表前调用 `pinner.hasStaleOrder()`（只读比较
     `desiredOrder(existingIds,pinnedOrder)` 与当前顺序），不一致就先 `reconcile()`，保证任何一次
     快照/面板刷新看到的顺序都是「置顶块在前」。
- `inject` 增加 `workspaceController`。
- **测试**：host-contract 新增 3 条断言（follow `order` 帧修复顺序、快照兜底修复顺序、修复走
  `insertBefore`），全套 **ALL PASSED**；client 88 checks failed 0。

### v2.1.4（气泡菜单收敛为单一「工作区配置」入口）

- **变更**：原生工作区气泡菜单不再有「设置备注… / 设置标题颜色（子菜单）/ 设置模型…」三项，
  合并为**一项「工作区配置」**（id `config`，icon key `workspace-toolkit.icon`），
  `run → openPanelField(ctx, workspaceId, '')`（打开面板、滚动并高亮该工作区，不强制聚焦某个输入框）。
  「置顶 / 取消置顶」保留为独立项（原生 `workspace.pin` / `workspace.unpin` 图标）。
- **变更**：`contextMenu.icon` 槽只注册 `workspace-toolkit.icon` 一个图标；
  删除 `IconMenuNote` / `IconMenuColor` / `IconMenuModel` / `swatchGlyph` / `IconColorReset` 五个已无用的工厂。
  颜色选择仍保留在配置面板内（8 个矩形色块 + 默认颜色 + 自定义色值）。
- **变更**：命名统一为「工作区配置」（`settings.nav` / `settings.title` / `overview.title` / `sidebar.entry`，
  EN: `Workspace configuration`），`settings.desc` 补上备注 / 颜色 / 置顶。
- **测试**：client-render **84 checks failed 0**（菜单断言改为 `pin,config`、config 项 label/icon、无 children；
  设置页标题断言改为「工作区配置」）。host 侧未改动，仍 ALL PASSED。

### v2.2.0（自定义模型供应商管理 UI + 连通性测试）

**动机**：用户要求自定义模型（如公司内部 MaaS `co-claw`，需要 `X-UAC-APP-ID` / `X-Emp-No` 等请求头）
必须能在界面上配置，而不是写死在 profile 的 `cordis.patch.yml` 里。原生「设置 → 模型」页能声明
pi-ai 自定义路由与 API Key，但**不提供 profile `headers` 编辑器**（README 明确 headers 是部署配置）。

**设计**：插件不实现自己的 LLM 适配器，纯配置层代理 —— 通过宿主 `configEditor` 服务读写
pi-ai adapter entry（`llm-pi-ai`）的 `config.providers`，与手写 profile 补丁等价（Loader 正常
reconcile / HMR 生效）；API key 走 `credentials.set`，配置里只留 `apiKeyEnv` 引用。

**host（index.js）**

- 服务依赖：`ctx.get('configEditor')`（`entries()` / `configuration()` / `edit(entry, change)`）、
  `ctx.get('credentials')`（`describe` / `set` / `resolve`）。
- 新增 sanitize/规范化函数：`sanitizeRoute`（`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`）、
  `deriveApiKeyEnv(route)`（`<ROUTE_UPPER>_API_KEY`）、`sanitizeHeaders`（≤20，header-name 校验，值截 512）、
  `normalizeModels`（≤40，`input` 只允许 `text|image`）、`cleanProviderPatch`（白名单字段 + baseURL 只允许 http/https）。
- `readProviderConfig()`：在 `configuration()` 里按 entry 身份（id `llm-pi-ai`，退化按 name 匹配）合并
  `inherited.providers` + `override.providers`；`providerView()` 对外只暴露
  `route/displayName/api/baseURL/headers/models/apiKeyEnv/apiKeyEnvExplicit/keyConfigured`，**永不返回密钥值**。
- `saveProvider(body)`：校验 route → 有 `apiKey` 先 `credentials.set(apiKeyEnv, key)` → `editor.edit(entry, …)`
  合并该 route（`delete:true` 时删除）→ 清模型目录缓存。
- `testProvider(body)`：按 `api` 选 `/chat/completions` 或 `/messages`，带 provider.headers 与凭据，
  `max_tokens: 16`，`AbortSignal.timeout(20000)`，返回 `{ok, route, url, status, latencyMs, detail}`
  或 `{ok:false, error:'network-error: …'}`。
- 快照新增 `customProviders`（服务缺失时 `{available:false, entryId:'llm-pi-ai', providers:[]}`）。
- 路由：`GET /providers`（列表）、`POST /providers`（保存/删除）、`POST /providers/test`（连通性）；
  `/providers` 只注册**一条** exact 路由并按 `req.method` 分派（同一 path 注册两个 handler 会互相遮蔽）。

**client（client.js）**

- 设置页新增「自定义模型」分区：列表行（显示名、route、API 协议徽标、baseURL、模型数、密钥状态点、
  编辑 / 测试 / 删除），行内编辑表单（route 编辑时只读、显示名、API 协议下拉、baseURL、
  password 型 API Key「空=不修改」、请求头 0..20 行、模型 0..40 行），保存 / 取消 / 删除二次确认，
  「测试」行内显示 `HTTP 200 · 812ms · model=…` 或后端错误原文；`available:false` 时整块禁用并提示。
- 保存成功后用响应里的 `customProviders` 刷新本地快照，并触发一次强制 `/snapshot` 刷新。

**测试**：host-contract 新增 `configEditor` / `credentials` / `fetch` 三类 mock，覆盖快照字段、GET 列表、
保存（派生 apiKeyEnv、headers 白名单、input 过滤、密钥不入配置）、删除、非法 route、三类测试结果、
服务缺失降级；全套 **ALL PASSED**。

### v2.2.1（工作区模型对「从未自选模型」的旧会话也生效）

- **变更**：`agent/created` 的来源过滤由 `source === 'startup'` 放宽为 `startup | resume`。
  恢复旧会话时，如果该会话从未记录过 `model/selection`（即一直跟随全局默认模型），
  就套用所属工作区的模型；若会话自己选过模型、已有 `requestHeader`、或属于子代理，仍然跳过。
  动机：用户在绑定 `co-claw` 之前创建的会话，恢复后仍走 DeepSeek，与「工作区已切到 co-claw」的预期不符。
- **测试**：host-contract 把旧的「resumed session keeps its own model」改为三条断言
  （无选择→套用、已选择→跳过、已有请求头→跳过），全套 **ALL PASSED**。

### v2.2.2（「展开/收起全部」图标重设计）

- **问题**：原图标是上下镜像内扣的两个 chevron（`M4 6l4-4 4 4` + `M4 10l4 4 4-4`），
  加上 1.5px 描边，在 14–16px 下会被看成叉号 ✕（用户反馈）。
- **改法**：改成**两个同向 chevron**（有收起行时两个向下 = 展开全部；全部展开时两个向上 = 收起全部），
  `viewBox 0 0 16 16`、`size 16`、`stroke-width 1.3`（对齐原生 medium 图标笔画），
  path 为 `M4.6 4.1L8 7.5l3.4-3.4` / `M4.6 8.5L8 11.9l3.4-3.4` 与 `M4.6 11.9L8 8.5l3.4 3.4` / `M4.6 7.5L8 4.1l3.4 3.4`。
- **测试**：client-render 新增 3 条断言（两个 path、两个 chevron 同向），共 **108 checks failed 0**。

### v3.0.0（重命名：workspace-model-panel → workspace-toolkit / 工作区工具箱）

- **原因**：插件能力已不止「模型 + 用量」，还包括供应商管理、左侧列表的各种改造，后续还会继续扩；
  旧名把范围说窄了。
- **改动**：包名 `@local/workspace-model-panel` → `@local/workspace-toolkit`；Loader entry id
  `workspace-model-panel` → `workspace-toolkit`；路由前缀 `/workspace-toolkit`；locale 命名空间、
  `contextMenu.icon` key、settings.section id、CSS 类名前缀 `wmp-` → `wtk-`、data 属性
  `data-wmp` → `data-wtk`；中文显示名「工作区工具箱」（EN `Workspace toolkit`）。
- **数据迁移**：首次启动时若旧位置存在数据会自动迁移 ——
  `plugin-data/workspace-model-panel.json` → `plugin-data/workspace-toolkit.json`（旧文件保留），
  storage json backend 的旧 unit 名同样会读出并写入新 unit。
  回归测试见 `test/legacy-migration.test.mjs`。
