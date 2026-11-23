# 工作区工具箱（workspace-toolkit）

一个 DSH Web 插件：围绕「工作区」做一站式增强与配置。当前包含模型配置、Token 用量、自定义模型供应商，
以及左侧工作区列表的展开/收起、置顶、备注、标题颜色等改造；后续新增的工作区能力也都会归到这个插件里。
菜单入口挂在**原生工作区气泡菜单**里，装饰挂在原生列表行上，不新增独立的侧边栏菜单。

> 设计前提：**不替换、不重写 DSH 原生界面**。插件只通过官方槽位注册自己的界面，并在原生工作区列表上做*追加式*装饰；关掉插件后原生界面完全恢复原样。

## 功能

### 1. 按工作区配置模型

- 默认所有工作区都**跟随当前正在使用的模型**（插件不做任何覆盖）。
- 可以在插件面板里为任意工作区单独指定厂商与模型；模型列表来自宿主 `llm` 服务的模型目录，
  也可以手动输入任意 `provider` / `model`（例如自建网关、或还没出现在目录里的新模型）。
- 新建会话时，如果该工作区配置了模型、且这个会话自己还没有模型选择，就把该模型应用到这个会话。
  - 应用时机：`agent/created` 事件，处理 `startup`（新会话）与 `resume`（恢复旧会话）两种来源。
    恢复时只有「该会话从未自己选过模型」才会套用，因此工作区改了模型后，之前一直跟随全局默认的旧会话
    会在下次打开时跟着切过去。
  - 用户主动切换过模型（会话里已记录 `model/selection`）→ 始终不覆盖。
  - 会话已有请求头（`requestHeader` 非空）→ 跳过。
  - 子代理 / 带 `parentSession` 的子会话 → 继承父会话模型，不套用工作区模型。
  - 清空（clear）、压缩（compact）的会话保持自己的选择。
- 实现方式与官方「配置路由」同构：调用 `agent.model.select(selection)`，它只是往会话日志追加一条
  `model/selection` 事件，因此绝不会悄悄改掉用户已有的选择。

### 2. 按工作区汇总 Token 用量

- 读取每个会话日志里 `assistant/message` 事件的 `usage`（输入 / 输出 / 总计 / 缓存读 / 缓存写 / 推理），
  **按工作区注册表里的 `sessionIds` 归属**到工作区（不按路径猜，避免同一目录被多个工作区引用时重复计数）。
- **只在打开设置页 / 总览面板时计算一次**，平时不扫会话日志：不带参数的快照只含工作区元数据，
  管理界面请求 `?usage=1` 才统计并缓存结果，按钮「刷新」可重算。

### 3. 原生工作区菜单里的入口

工作区标题右侧省略号（或右键）打开的原生气泡菜单里，插件通过官方 `contextMenus` 服务追加**两项**
（排在「重命名」之后、「删除工作区」之前，与原生条目同一套渲染与键盘操作）：

- **置顶工作区 / 取消置顶**：直接写原生持久化顺序；置顶块始终排在最前。
  新建工作区会被宿主 prepend 到顺序最前面，插件监听工作区 follow 流（`order/upsert/remove` 帧，250ms 防抖）
  并在每次取快照前兜底校正，保证置顶工作区不会因为「新建一个工作区」而被挤下去。
- **工作区配置**：打开插件面板并高亮、定位到该工作区；模型、备注、标题颜色、Token 用量都在这一页改
  （标题颜色是页内 8 个矩形色块，不出现色号）。

菜单条目来自 `ctx.contextMenus.register({ target: 'workspace' })`，是原生自己的扩展机制；
置顶复用原生 `workspace.pin` / `workspace.unpin` 图标，「工作区配置」用插件自带图标
（注册在 `contextMenu.icon` keyed 槽）。

### 4. 左侧工作区列表的增强（追加式）

以下元素都是插件在原生列表之上**追加**的，不改原生节点、不接管原生行为：

- **展开 / 收起全部**：工作区区块标题右侧一个小图标按钮，一键展开或收起所有工作区
  （按行上的 `aria-expanded` 判断当前是「全部展开」还是「全部收起」，再逐行触发原生点击）。
- **置顶标记**：已置顶的工作区标题前显示品牌色图钉，一眼可辨；排序本身由宿主
  `workspaceRegistry.insertBefore(id, beforeId)` 改写**原生持久化顺序**完成，
  所以拖拽、分组、重启后都和原生一致（不是 CSS 排序 hack）。
- **标题备注**：在工作区标题后用括号展示备注，例如 `my-project（支付重构）`。
- **标题颜色**：单个工作区标题可用颜色区分。面板里以矩形色块选择（悬停显示颜色名），
  另提供「自定义色值」输入框给高级用法（受白名单校验：`#hex` / `rgb()` / `hsl()` / `var(--token)`）。
- **模型徽标**：工作区配置了模型覆盖时显示模型名。

原生能力（分组 / 拖拽重排 / 搜索 / 归档过滤 / 会话行菜单 / hover 卡 / 第三方会话行插槽 / rail 模式 …）
全部保留，插件不注册 `sidebar.workspaces` 槽，也不动 `sidebar` 槽。

### 5. 自定义模型供应商（设置页）

很多公司内部网关的模型不是 OpenAI 标准形态：需要额外请求头（例如内部 MaaS 的 `X-UAC-APP-ID` / `X-Emp-No`）、
或者根本还没出现在宿主模型目录里。DSH 原生「设置 → 模型」页能声明 pi-ai 自定义路由和 API Key，
但**不支持编辑 profile `headers`**（那是部署配置）。插件补上的正是这一块：

- 设置页新增「自定义模型」分区：列出所有通过 pi-ai 适配器声明的自定义供应商（显示名、route、API 协议、
  baseURL、模型数、密钥是否已配置）。
- 新增/编辑：route、显示名、API 协议（OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）、
  baseURL、API Key、任意请求头（0..20 行）、模型列表（0..40 行：id / 显示名 / 上下文窗口 / 最大输出 / 输入类型）。
- 保存后写入宿主 **pi-ai 适配器 entry（`llm-pi-ai`）的 `config.providers`**，走官方 `configEditor` 服务
  （`Validate, persist, and reconcile`），与手写 profile `cordis.patch.yml` 完全等价，宿主会正常 reconcile、
  新供应商即时出现在工作区的「配置模型」下拉里。插件**不内置任何厂商**。
- API Key 写入宿主凭据库（`~/.dsh/.credentials.yaml` 的 `refs`），配置里只保存 `apiKeyEnv` 引用，
  接口与界面都不会回显密钥明文。
- 每行提供「测试」：host 用该供应商的 baseURL / headers / 凭据真实发一次 16 token 的请求，
  行内显示 `HTTP 200 · 812ms · model=…` 或具体错误（超时 20s）。

> 需要宿主提供 `configEditor` 与 `credentials` 服务；缺失时该分区显示为不可用，其余功能不受影响。

### 6. 入口

- **设置页**：设置 → 「工作区工具箱」（插件自带图标），可在这里配置每个工作区的模型、备注、颜色、置顶。
- **插件面板**：设置页里的「打开总览面板」，或从工作区菜单的「工作区配置」直接跳入并聚焦。
  面板占据原生 main 区域，自己管理滚动（`flex:1;min-height:0` 容器 + 内部滚动层），内容按 880px 列居中。
- 不再在左侧边栏添加底部菜单入口（按反馈已移除）。

## 安装

```bash
# 从 NPM 安装（推荐）
dsh plugin --profile web add @ylhsweet/dsh-workspace-toolkit
```

也可以在本地开发时直接安装当前目录：

```bash
dsh plugin --profile web add /absolute/path/to/workspace-toolkit-plugin
```

安装后刷新 Web 页面即可。

## 数据与存储

- 优先使用 DSH 的 storage json backend（`workspace-toolkit` 域，`workspaces` 表 + global 区）。
- backend 不可用时回退到 `~/.dsh/profiles/<profile>/plugin-data/workspace-toolkit.json`（tmp + rename 原子写）。
- 每个工作区只存：`model`（覆盖，null 表示跟随）、`note`、`color`、`pinned`（用于展示与向下兼容）；
  真正的排序以宿主工作区注册表为准。
- 全局只存：`pinnedOrder`（置顶块顺序）；`settings.showSidebarEntry` 为早期侧边栏入口留下的历史字段，
  现在不再生效（入口已移除），读写时保留以免破坏旧数据。

数据结构版本 `2`，读取时会自动从 v1（`order` / `collapsed` / 按 cwd 分桶的旧数据）迁移丢弃无关字段。

## 宿主路由（同源，仅本插件使用）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/workspace-toolkit/snapshot` | 快照（工作区 + 模型目录 + 设置）；`?usage=1` 才统计 Token 用量并缓存 |
| POST | `/workspace-toolkit/meta` | 改单个工作区：`{workspaceId, patch}`；或批量：`{items:[{workspaceId,patch}]}` |
| POST | `/workspace-toolkit/settings` | 改全局设置（保留兼容，当前无界面使用） |
| GET/POST | `/workspace-toolkit/client-report` | 客户端自报诊断（槽位注册失败、装饰层异常） |
| GET | `/workspace-toolkit/ping` | 诊断：存储方式、工作区数、置顶块、模型提供方数、最近一次客户端报告 |
| GET | `/workspace-toolkit/providers` | 自定义模型供应商列表（`{available, entryId, providers}`，永不返回密钥） |
| POST | `/workspace-toolkit/providers` | 新增/编辑/删除供应商：`{route, patch:{…, apiKey?, delete?}}`，`apiKey` 只写不读 |
| POST | `/workspace-toolkit/providers/test` | 连通性测试：`{route, model?}` → `{ok, url, status, latencyMs, detail}` |

## 边界与已知限制

- 装饰层依赖当前 DSH 版本原生列表的类名（`NSkPbW_*` / `wh7htW_*`）与 `data-row-key="workspace:<id>"`。
  插件对每个容器做存在性检查：找不到就静默跳过并写一条 `client-report`，不会抛错、不会破坏页面。
  升级 DSH 大版本后如左侧增强不显示，先看 `/workspace-toolkit/client-report`。
- 装饰层只追加自己创建的节点和一条自己的 `<style data-plugin-css>`；卸载时全部移除。
- 不读取、不上传任何会话内容，只统计用量数字。
- 自定义模型供应商由宿主 `configEditor` 落盘到 profile 补丁层（`llm-pi-ai` entry），因此**刷新页面/重启后依然存在**；
  删除供应商只删该 route 的配置，不会动 `apiKeyEnv` 指向的凭据记录（需要时请在宿主设置里另行清理）。

## 测试

```bash
node --check index.js && node --check client.js
node test/host-contract.test.mjs     # host 半边：路由 / 快照 / 置顶 / 用量 / agent/created / 供应商 CRUD / 落盘
node test/client-render.test.mjs     # client 半边：槽位注册 / 设置页 / 面板 / 装饰层逻辑
node test/legacy-migration.test.mjs  # 旧版插件（workspace-model-panel）数据迁移
```
