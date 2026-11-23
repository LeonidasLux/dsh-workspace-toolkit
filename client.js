// 工作区工具箱 · Client half
//
// 这是一个「同进程 Client 半」：Web 端的模块加载器执行本文件时只会注册一个
// 惰性 factory（window.__ModuleLoader__.load），真正的副作用全部发生在 factory
// 被物化（require）之后的 apply 里，因此可以安全地插入样式表、注册 slot。
//
// 提供的界面：
//   1. 设置界面入口（settings.section + settings.section.icon）：每工作区模型/备注/
//      颜色/置顶与按工作区汇总的 Token 用量。
//   2. 插件面板（main keyed slot）：全局汇总 + 每工作区配置，右键菜单可跳转并聚焦。
//   3. 原生工作区右键菜单的 2 个入口（contextMenus 官方扩展点）：置顶 / 工作区配置
//      （备注、标题颜色、模型统一在配置面板里改），不向原生菜单 DOM 注入任何节点。
//   4. 设置页内的「自定义模型」分区：把 OpenAI/Anthropic 兼容的自定义供应商（含
//      自定义请求头与凭据）写进宿主 pi-ai 适配器的 config.providers。
//   5. 原生工作区区域的「追加式装饰层」：只在原生节点内部 append 自建节点，
//      不注册、不替换原生工作区区域，也不修改原生 React 树与节点属性。
window.__ModuleLoader__.load({
  id: '@ylhsweet/dsh-workspace-toolkit',
  factory: function (require) {
    'use strict'
    var PKG_ID = '@ylhsweet/dsh-workspace-toolkit'
    var NS = 'workspace-toolkit'
    var ROUTE_PREFIX = '/workspace-toolkit'
    var PANEL_ID = 'workspace-toolkit'
    var STYLE_ID = PKG_ID + ':styles'
    var DECO_STYLE_ID = 'workspace-toolkit:decorator'
    var inject = ['slots', 'locale', 'layout', 'contextMenus']
    var module = { exports: {} }
    var React = null
    try {
      React = require('react')
    } catch (error) {
      React = null
    }
    function h() {
      return React.createElement.apply(null, arguments)
    }

    // ------------------------------------------------------------ 词典
        var ZH = {
      'sidebar.section': '工作区',       'sidebar.expandAll': '展开全部',
      'sidebar.collapseAll': '收起全部',       'sidebar.entry': '工作区配置',
      'workspace.model': '配置模型…',       'workspace.note': '备注',
      'workspace.color': '标题颜色',       'workspace.colorCustom': '自定义色值（可选）',
      'workspace.pin': '置顶工作区',
      'workspace.unpin': '取消置顶',       'swatch.blue': '蓝色',
      'swatch.green': '绿色',       'swatch.amber': '琥珀色',
      'swatch.red': '红色',       'swatch.violet': '紫色',
      'swatch.cyan': '青色',       'swatch.pink': '粉色',
      'swatch.gray': '灰色',       'workspace.colorInvalid': '无效颜色：只支持 #rgb、#rrggbb、rgb()、hsl() 或 var(--dsw-*)',
      'workspace.clearColor': '默认颜色',       'model.followDefault': '跟随当前模型（{model}）',
      'model.followCurrent': '跟随当前模型',       'model.followShort': '跟随当前',
      'model.custom': '自定义模型',       'model.customProvider': '厂商 ID，例如 openai / deepseek',
      'model.customModel': '模型 ID，例如 gpt-4o',       'model.apply': '应用',
      'model.invalid': '请填写厂商 ID 与模型 ID',       'note.placeholder': '例如：主力项目',
      'refresh': '刷新',       'tokens.input': '输入',
      'tokens.output': '输出',       'tokens.total': '合计',
      'tokens.cacheRead': '缓存读',       'tokens.cacheWrite': '缓存写',
      'tokens.reasoning': '推理',       'tokens.sessions': '会话数',
      'pinned': '已置顶',       'settings.nav': '工作区工具箱',
      'settings.title': '工作区工具箱',       'settings.desc': '为每个工作区单独设置模型、备注、标题颜色与置顶，并查看按工作区汇总的 Token 用量。',
      'settings.showSidebar': '在左侧边栏显示本插件入口',       'settings.showSidebarHint': '关闭后仍可从设置里进入本页。',
      'settings.openOverview': '打开总览面板',       'overview.title': '工作区工具箱',
      'overview.desc': '为单个工作区配置模型（默认跟随当前使用的模型），查看按工作区汇总的 Token 用量，并管理左侧工作区列表的置顶、备注与颜色。',       'overview.global': '全局设置',
      'overview.summary': '全局汇总',       'overview.workspaces': '工作区模型',
      'overview.usage': 'Token 用量汇总',       'overview.hint': '工作区模型只影响之后新建的会话，不会修改已有会话；未配置模型的工作区跟随当前使用的模型。',
      'overview.workspacesEmpty': '还没有工作区。',       'overview.lastUpdated': '上次更新：{time}',
      'overview.workspacesCount': '工作区数',
      'decorator.modelTitle': '该工作区配置的模型',       'decorator.toggleExpand': '展开全部工作区',
      'decorator.toggleCollapse': '收起全部工作区',       'status.loading': '加载中…',
      'status.loadFailed': '加载失败：{message}',       'action.failed': '操作失败：{message}',
      'note.paren': '（{note}）',
      'workspace.config': '工作区配置',       'action.failedShort': '操作失败',
      'providers.title': '自定义模型',       'providers.desc': '添加任意 OpenAI / Anthropic 兼容的自定义模型（可带自定义请求头）。保存后可在工作区「配置模型」里选择；配置写入宿主 pi-ai 适配器，插件不内置任何厂商。',
      'providers.add': '添加供应商',       'providers.empty': '还没有自定义供应商。',
      'providers.unavailable': '当前宿主未提供 configEditor 服务，无法管理自定义模型供应商。',       'providers.route': '供应商 ID',
      'providers.routeHint': '仅限字母、数字、点、下划线与连字符，最长 64 个字符',       'providers.routeLocked': '保存后不可修改供应商 ID',
      'providers.displayName': '显示名称',       'providers.api': 'API 类型',
      'providers.apiChatCompletions': 'OpenAI Chat Completions',       'providers.apiResponses': 'OpenAI Responses',
      'providers.apiAnthropic': 'Anthropic Messages',       'providers.baseURL': 'Base URL',
      'providers.baseURLHint': '留空表示使用适配器默认地址',       'providers.apiKey': 'API Key',
      'providers.apiKeyConfiguredPlaceholder': '已配置（留空不修改）',       'providers.apiKeyPlaceholder': '填写 API Key',
      'providers.apiKeyEnvHint': '密钥保存到宿主凭据库，配置中只保留引用：{name}',       'providers.headers': '请求头',
      'providers.addHeader': '添加请求头',       'providers.headerName': '名称',
      'providers.headerValue': '值',       'providers.models': '模型',
      'providers.modelsCount': '{count} 个模型',       'providers.addModel': '添加模型',
      'providers.modelId': '模型 ID',       'providers.modelName': '显示名',
      'providers.contextWindow': '上下文窗口',       'providers.maxTokens': '最大输出',
      'providers.inputType': '输入类型',       'providers.inputText': '文本',
      'providers.inputTextImage': '文本+图片',       'providers.save': '保存',
      'providers.cancel': '取消',       'providers.edit': '编辑',
      'providers.test': '测试',       'providers.delete': '删除',
      'providers.confirmDelete': '确认删除',       'providers.saved': '已保存，模型目录稍后刷新',
      'providers.deleted': '已删除，模型目录稍后刷新',       'providers.testing': '测试中…',
      'providers.testOk': 'HTTP {status} · {latency}ms · {detail}',       'providers.testFail': 'HTTP {status} · {latency}ms · {error}',
      'providers.testNetwork': '请求失败：{error}',       'providers.validationRoute': '请填写合法的供应商 ID（字母、数字、点、下划线、连字符）',
      'providers.validationModels': '至少填写一个模型 ID',       'providers.validationBaseURL': 'Base URL 必须以 http:// 或 https:// 开头',
      'providers.keyConfigured': '密钥已配置',       'providers.keyMissing': '密钥未配置',
    }
        var EN = {
      'sidebar.section': 'Workspaces',       'sidebar.expandAll': 'Expand all',
      'sidebar.collapseAll': 'Collapse all',       'sidebar.entry': 'Workspace configuration',
      'workspace.model': 'Configure model…',       'workspace.note': 'Note',
      'workspace.color': 'Title color',       'workspace.colorCustom': 'Custom value (optional)',
      'workspace.pin': 'Pin workspace',
      'workspace.unpin': 'Unpin workspace',       'swatch.blue': 'Blue',
      'swatch.green': 'Green',       'swatch.amber': 'Amber',
      'swatch.red': 'Red',       'swatch.violet': 'Violet',
      'swatch.cyan': 'Cyan',       'swatch.pink': 'Pink',
      'swatch.gray': 'Gray',       'workspace.colorInvalid': 'Invalid color: use #rgb, #rrggbb, rgb(), hsl() or var(--dsw-*)',
      'workspace.clearColor': 'Default color',       'model.followDefault': 'Follow current model ({model})',
      'model.followCurrent': 'Follow the current model',       'model.followShort': 'Following',
      'model.custom': 'Custom model',       'model.customProvider': 'Provider id, e.g. openai / deepseek',
      'model.customModel': 'Model id, e.g. gpt-4o',       'model.apply': 'Apply',
      'model.invalid': 'Fill in both the provider id and the model id',       'note.placeholder': 'e.g. main project',
      'refresh': 'Refresh',       'tokens.input': 'Input',
      'tokens.output': 'Output',       'tokens.total': 'Total',
      'tokens.cacheRead': 'Cache read',       'tokens.cacheWrite': 'Cache write',
      'tokens.reasoning': 'Reasoning',       'tokens.sessions': 'Sessions',
      'pinned': 'Pinned',       'settings.nav': 'Workspace toolkit',
      'settings.title': 'Workspace toolkit',       'settings.desc': 'Pick a model per workspace and review token usage grouped by workspace.',
      'settings.showSidebar': 'Show this plugin entry in the left sidebar',       'settings.showSidebarHint': 'The page stays reachable from Settings when disabled.',
      'settings.openOverview': 'Open overview panel',       'overview.title': 'Workspace toolkit',
      'overview.desc': 'Configure a model per workspace (follows the current model by default), review token usage grouped by workspace, and manage pinning, notes and title colors for the left workspace list.',       'overview.global': 'Global settings',
      'overview.summary': 'Global summary',       'overview.workspaces': 'Workspace models',
      'overview.usage': 'Token usage',       'overview.hint': 'A workspace model only affects new sessions; sessions without an override follow the current model.',
      'overview.workspacesEmpty': 'No workspaces yet.',       'overview.lastUpdated': 'Last updated: {time}',
      'overview.workspacesCount': 'Workspaces',
      'decorator.modelTitle': 'Model configured for this workspace',       'decorator.toggleExpand': 'Expand all workspaces',
      'decorator.toggleCollapse': 'Collapse all workspaces',       'status.loading': 'Loading…',
      'status.loadFailed': 'Failed to load: {message}',       'action.failed': 'Action failed: {message}',
      'note.paren': ' ({note})',
      'workspace.config': 'Workspace configuration',       'action.failedShort': 'Action failed',
      'providers.title': 'Custom models',       'providers.desc': 'Add any OpenAI / Anthropic compatible custom model (optionally with custom request headers). After saving, pick it in a workspace "Configure model"; the configuration is written into the host pi-ai adapter — the plugin ships no vendors itself.',
      'providers.add': 'Add provider',       'providers.empty': 'No custom providers yet.',
      'providers.unavailable': 'This host does not expose the configEditor service, so custom providers cannot be managed here.',       'providers.route': 'Provider ID',
      'providers.routeHint': 'Letters, digits, dots, underscores and hyphens only; up to 64 characters',       'providers.routeLocked': 'Provider ID cannot be changed after saving',
      'providers.displayName': 'Display name',       'providers.api': 'API type',
      'providers.apiChatCompletions': 'OpenAI Chat Completions',       'providers.apiResponses': 'OpenAI Responses',
      'providers.apiAnthropic': 'Anthropic Messages',       'providers.baseURL': 'Base URL',
      'providers.baseURLHint': 'Leave empty to use the adapter default',       'providers.apiKey': 'API Key',
      'providers.apiKeyConfiguredPlaceholder': 'Configured (leave empty to keep)',       'providers.apiKeyPlaceholder': 'Enter API key',
      'providers.apiKeyEnvHint': 'The key is stored in the host credential store; the config only keeps a reference: {name}',       'providers.headers': 'Request headers',
      'providers.addHeader': 'Add header',       'providers.headerName': 'Name',
      'providers.headerValue': 'Value',       'providers.models': 'Models',
      'providers.modelsCount': '{count} model(s)',       'providers.addModel': 'Add model',
      'providers.modelId': 'Model ID',       'providers.modelName': 'Display name',
      'providers.contextWindow': 'Context window',       'providers.maxTokens': 'Max output',
      'providers.inputType': 'Input type',       'providers.inputText': 'Text',
      'providers.inputTextImage': 'Text + images',       'providers.save': 'Save',
      'providers.cancel': 'Cancel',       'providers.edit': 'Edit',
      'providers.test': 'Test',       'providers.delete': 'Delete',
      'providers.confirmDelete': 'Confirm delete',       'providers.saved': 'Saved. The model catalog refreshes shortly.',
      'providers.deleted': 'Deleted. The model catalog refreshes shortly.',       'providers.testing': 'Testing…',
      'providers.testOk': 'HTTP {status} · {latency}ms · {detail}',       'providers.testFail': 'HTTP {status} · {latency}ms · {error}',
      'providers.testNetwork': 'Request failed: {error}',       'providers.validationRoute': 'Enter a valid provider ID (letters, digits, dots, underscores, hyphens)',
      'providers.validationModels': 'Add at least one model ID',       'providers.validationBaseURL': 'Base URL must start with http:// or https://',
      'providers.keyConfigured': 'API key configured',       'providers.keyMissing': 'API key missing',
    }

    // ------------------------------------------------------------ 样式
    var STYLE_TEXT = [
      '.wtk-root{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;height:100%;width:100%;overflow:hidden;color:var(--dsw-alias-label-primary);}',
      '.wtk-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding:20px 24px 40px;}',
      '.wtk-root[data-inline="true"]{height:auto;overflow:visible;}',
      '.wtk-root[data-inline="true"] .wtk-scroll{flex:0 0 auto;overflow:visible;padding:0;}',
      '.wtk-page{display:flex;flex-direction:column;gap:18px;width:100%;max-width:880px;margin:0 auto;padding:0;color:var(--dsw-alias-label-primary);}',
      '.wtk-page *{box-sizing:border-box;}',
      '.wtk-page h2{margin:0;font-size:18px;line-height:26px;}',
      '.wtk-page .wtk-desc{margin:4px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary);}',
      '.wtk-card{padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);}',
      '.wtk-card h3{margin:0 0 10px;font-size:14px;line-height:20px;}',
      '.wtk-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.wtk-row:first-of-type{border-top:0;}',
      '.wtk-row-main{flex:1 1 auto;min-width:0;}',
      '.wtk-row-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wtk-row-sub{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wtk-row-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end;}',
      '.wtk-ws-block{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.wtk-ws-block:first-of-type{border-top:0;padding-top:0;}',
      '.wtk-ws-config{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:10px;align-items:end;}',
      '.wtk-field{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.wtk-field label{font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.wtk-input,.wtk-select{width:100%;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;}',
      '.wtk-input:focus,.wtk-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.wtk-btn{padding:5px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;}',
      '.wtk-btn:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.wtk-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.wtk-btn[data-primary="true"]{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff;}',
      '.wtk-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:0 0 auto;}',
      '.wtk-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.wtk-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.wtk-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);}',
      '.wtk-error{margin-top:8px;color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-word;}',
      '.wtk-empty{padding:6px 0;color:var(--dsw-alias-label-secondary);font-size:12px;}',
      '.wtk-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;white-space:nowrap;}',
      '.wtk-chip[data-brand="true"]{color:var(--dsw-alias-brand-primary);}',
      '.wtk-tokens-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;}',
      '.wtk-swatches{display:flex;flex-wrap:wrap;gap:6px;}',
      '.wtk-swatch{width:22px;height:22px;padding:0;border:2px solid transparent;border-radius:5px;cursor:pointer;}',
      '.wtk-swatch[data-active="true"]{border-color:var(--dsw-alias-label-primary);}',
      '.wtk-swatch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
      '.wtk-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums;}',
      '.wtk-table th,.wtk-table td{padding:6px 8px;text-align:right;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.wtk-table th{font-weight:600;color:var(--dsw-alias-label-secondary);}',
      '.wtk-table th:first-child,.wtk-table td:first-child{text-align:left;}',
      '.wtk-table tr[data-total="true"] td{font-weight:600;}',
      '.wtk-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;}',
      '.wtk-stat{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);min-width:0;}',
      '.wtk-stat-label{font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.wtk-stat-value{margin-top:2px;font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wtk-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.wtk-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}',
      '/* 追加式装饰层：只影响自建节点与标题行布局，不覆盖原生节点属性。 */',
      '[role="treeitem"][data-row-key^="workspace:"] [class*="_projectText"]{flex-direction:row;align-items:baseline;gap:4px;overflow:hidden;}',
      '[role="treeitem"][data-row-key^="workspace:"] [class*="_title"]{flex:0 1 auto;}',
      'span[data-wtk="note"]{flex:0 1 auto;min-width:0;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);}',
      'span[data-wtk="pin"]{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary);}',
      'span[data-wtk="model"]{flex:0 0 auto;max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary);}',
      '.wtk-ws-block[data-wtk-flash="1"]{border-radius:8px;box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);transition:box-shadow .2s;}',
      'button[data-wtk="toggle-all"]{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:0 0 auto;}',
      'button[data-wtk="toggle-all"]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      'button[data-wtk="toggle-all"]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.wtk-providers .wtk-subhead{margin-bottom:4px;}',
      '.wtk-provider-block{padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.wtk-provider-block:first-of-type{border-top:0;}',
      '.wtk-provider-row{display:flex;align-items:flex-start;gap:10px;}',
      '.wtk-provider-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.wtk-provider-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}',
      '.wtk-provider-url{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.wtk-key-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-error-primary);}',
      '.wtk-key-dot[data-on="true"]{background:var(--dsw-alias-state-success-primary);}',
      '.wtk-provider-form{display:flex;flex-direction:column;gap:10px;margin-top:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);}',
      '.wtk-provider-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;}',
      '.wtk-provider-rows{display:flex;flex-direction:column;gap:6px;}',
      '.wtk-edit-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.wtk-edit-row .wtk-input,.wtk-edit-row .wtk-select{flex:1 1 140px;min-width:110px;width:auto;}',
      '.wtk-edit-row .wtk-input.wtk-num{flex:0 0 104px;min-width:104px;}',
      '.wtk-edit-row .wtk-select.wtk-input-select{flex:0 0 132px;min-width:132px;}',
      '.wtk-form-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.wtk-notice{font-size:12px;color:var(--dsw-alias-state-success-primary);}',
      '.wtk-test-line{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-word;}',
      '.wtk-test-line[data-ok="false"]{color:var(--dsw-alias-state-error-primary);}',
    ].join('\n')

    // ------------------------------------------------------------ 小工具
    function formatInt(value) {
      var n = Number(value) || 0
      return n.toLocaleString()
    }
    function formatCompact(value) {
      var n = Number(value) || 0
      if (n < 1000) return String(n)
      if (n < 1000000) {
        var k = n / 1000
        return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'k'
      }
      var m = n / 1000000
      return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10) + 'M'
    }
    function formatTime(iso) {
      if (!iso) return ''
      try {
        return new Date(iso).toLocaleString()
      } catch (error) {
        return String(iso)
      }
    }
    function emptyUsage() {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        sessions: 0,
      }
    }
    function workspaceUsage(workspace) {
      var usage = workspace && workspace.usage
      if (!usage || typeof usage !== 'object') return emptyUsage()
      return {
        inputTokens: Number(usage.inputTokens) || 0,
        outputTokens: Number(usage.outputTokens) || 0,
        totalTokens: Number(usage.totalTokens) || 0,
        cacheReadTokens: Number(usage.cacheReadTokens) || 0,
        cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
        reasoningTokens: Number(usage.reasoningTokens) || 0,
        sessions: Number(usage.sessions) || 0,
      }
    }
    function truncate(value, max) {
      var text = String(value == null ? '' : value)
      if (text.length <= max) return text
      return text.slice(0, Math.max(1, max - 1)) + '…'
    }
    function readJson(response) {
      return response.json().catch(function () {
        return { ok: false, error: 'invalid JSON response' }
      })
    }
    var COLOR_PATTERN = [
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/,
      /^rgba?\(\s*[-+0-9.%\s,]+\)$/,
      /^hsla?\(\s*[-+0-9.%\s,deg]+\)$/,
      /^var\(--dsw-[a-zA-Z0-9-]+\)$/,
    ]
    // 只接受规格里声明的颜色写法；Host 也会再校验一次，这里主要为避免注入。
    function isSafeColor(value) {
      if (typeof value !== 'string') return false
      var text = value.trim()
      if (!text) return false
      for (var i = 0; i < COLOR_PATTERN.length; i += 1) {
        if (COLOR_PATTERN[i].test(text)) return true
      }
      return false
    }
    // 每个插件实例一份共享 store：侧边栏入口 / 面板 / 装饰层都订阅它。
    function createStore() {
      var state = { phase: 'loading', error: '', snapshot: null }
      var listeners = new Set()
      return {
        get: function () { return state },
        set: function (next) {
          state = next
          listeners.forEach(function (listener) { listener() })
        },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
      }
    }
    function useStoreState(store) {
      var pair = React.useState(store.get())
      var value = pair[0]
      var setValue = pair[1]
      React.useEffect(function () {
        setValue(store.get())
        return store.subscribe(function () { setValue(store.get()) })
      }, [store])
      return value
    }

    // ------------------------------------------------------------ 图标（内联 SVG，避免依赖 Client 包）
    function svg(size, children, extra) {
      return h('svg', Object.assign({
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, extra || {}), children)
    }
    function IconExpandAll(props) {
      return svg(props.size || 14, [
        h('path', { key: 'a', d: 'M4 6l4-4 4 4' }),
        h('path', { key: 'b', d: 'M4 10l4 4 4-4' }),
      ])
    }
    function IconCollapseAll(props) {
      return svg(props.size || 14, [
        h('path', { key: 'a', d: 'M4 4l4 4 4-4' }),
        h('path', { key: 'b', d: 'M4 12l4-4 4 4' }),
      ])
    }
    function IconRefresh(props) {
      return svg(props.size || 14, [
        h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.6-3.7' }),
        h('path', { key: 'b', d: 'M13 2.5V6h-3.5' }),
      ])
    }
    function PluginGlyph(props) {
      var size = props.size || 16
      return svg(size, [
        h('rect', { key: 'a', x: 2, y: 3, width: 12, height: 3.2, rx: 1 }),
        h('rect', { key: 'b', x: 2, y: 7.6, width: 12, height: 2.4, rx: 1 }),
        h('rect', { key: 'c', x: 2, y: 11.4, width: 8, height: 2.2, rx: 1 }),
      ], { strokeWidth: 1.3 })
    }
    // ------------------------------------------------------------ 数据访问
    function createBackend(ctx, store) {
      var inflight = null
      var lastError = ''
      function applySnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || snapshot.ok !== true) return false
        lastError = ''
        store.set({ phase: 'ready', error: '', snapshot: snapshot })
        return true
      }
      async function request(path, options) {
        var response = await fetch(ROUTE_PREFIX + path, Object.assign({ cache: 'no-store' }, options || {}))
        var data = await readJson(response)
        if (!response.ok) {
          var message = (data && data.error) || ('HTTP ' + response.status)
          throw new Error(typeof message === 'string' ? message : 'HTTP ' + response.status)
        }
        return data
      }
      function refresh(withUsage) {
        if (inflight) return inflight
        inflight = request('/snapshot' + (withUsage ? '?usage=1' : ''))
          .then(function (data) {
            applySnapshot(data)
            return data
          })
          .catch(function (error) {
            lastError = String((error && error.message) || error)
            store.set({ phase: 'error', error: lastError, snapshot: store.get().snapshot })
            throw error
          })
          .finally(function () { inflight = null })
        return inflight
      }
      async function post(path, body) {
        var data = await request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        })
        if (!data || data.ok !== true) {
          throw new Error((data && data.error) || 'request refused')
        }
        applySnapshot(data)
        return data
      }
      // 自定义模型供应商：Host 把它们写进官方 pi-ai 适配器 entry 的 config.providers。
      // GET /providers 返回 {available,entryId,providers}；POST 返回 {ok,route,removed,customProviders}，
      // 不含完整 snapshot，因此不能走通用 post()，只把 customProviders 合入本地快照。
      function applyCustomProviders(customProviders) {
        if (!customProviders || typeof customProviders !== 'object') return false
        var state = store.get()
        var current = state.snapshot
        if (!current || typeof current !== 'object' || current.ok !== true) return false
        store.set({
          phase: state.phase,
          error: state.error,
          snapshot: Object.assign({}, current, { customProviders: customProviders }),
        })
        return true
      }
      async function loadProviders() {
        var data = await request('/providers')
        if (!data || typeof data !== 'object') throw new Error('invalid providers response')
        if (data.ok === false) throw new Error(data.error || 'request refused')
        applyCustomProviders(data)
        return data
      }
      async function patchProvider(route, patch) {
        var data = await request('/providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ route: route, patch: patch || {} }),
        })
        if (!data || data.ok !== true) throw new Error((data && data.error) || 'request refused')
        if (data.customProviders) applyCustomProviders(data.customProviders)
        // 保存后宿主需要一次 Loader reconcile 才会把供应商注册进模型目录（通常 1–2 秒）。
        refresh(true).catch(function () { /* 目录刷新失败不影响保存结果 */ })
        return data
      }
      async function testProvider(route, model) {
        return request('/providers/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ route: route, model: model || '' }),
        })
      }
      return {
        refresh: refresh,
        post: post,
        patchMeta: function (workspaceId, patch) {
          return post('/meta', { workspaceId: workspaceId, patch: patch })
        },
        patchSettings: function (patch) {
          return post('/settings', { patch: patch })
        },
        loadProviders: loadProviders,
        patchProvider: patchProvider,
        testProvider: testProvider,
        applyCustomProviders: applyCustomProviders,
        get lastError() { return lastError },
      }
    }

    // ------------------------------------------------------------ 菜单 → 面板 聚焦通道
    // 右键菜单的 run 只是普通回调：写入请求后切到本插件面板；面板订阅后滚动、高亮并聚焦。
    var focusChannel = (function () {
      var value = null
      var subscribers = new Set()
      return {
        get: function () { return value },
        set: function (next) {
          value = next
          subscribers.forEach(function (fn) {
            try { fn(next) } catch (error) { /* 忽略单个订阅者错误 */ }
          })
        },
        subscribe: function (fn) {
          subscribers.add(fn)
          return function () { subscribers.delete(fn) }
        },
      }
    })()
    function useFocusRequest() {
      var pair = React.useState(focusChannel.get())
      var value = pair[0]
      var setValue = pair[1]
      React.useEffect(function () {
        return focusChannel.subscribe(function (next) { setValue(next) })
      }, [])
      return value
    }
    // 面板渲染完成后滚动到目标工作区块、短时高亮并聚焦对应输入框。
    function useFocusEffect(focusRequest) {
      React.useEffect(function () {
        if (!focusRequest || !focusRequest.workspaceId) return undefined
        var timer = null
        function applyFocus(request) {
          if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return
          var block = null
          try {
            block = document.querySelector('[data-wtk-ws="' + cssAttrEscape(request.workspaceId) + '"]')
          } catch (error) { return }
          if (!block) return
          if (typeof block.scrollIntoView === 'function') {
            try { block.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (error) { /* 旧浏览器忽略 */ }
          }
          block.setAttribute('data-wtk-flash', '1')
          timer = setTimeout(function () {
            if (block && typeof block.removeAttribute === 'function') block.removeAttribute('data-wtk-flash')
          }, 1200)
          var field = request.field
          var input = field && typeof block.querySelector === 'function'
            ? block.querySelector('[data-wtk-field="' + field + '"]')
            : null
          if (input && typeof input.focus === 'function') {
            try { input.focus() } catch (error) { /* 忽略聚焦失败 */ }
          }
        }
        var handle = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(function () { applyFocus(focusRequest) })
          : setTimeout(function () { applyFocus(focusRequest) }, 0)
        return function () {
          if (timer !== null) clearTimeout(timer)
          if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') cancelAnimationFrame(handle)
          else if (typeof clearTimeout === 'function') clearTimeout(handle)
        }
      }, [focusRequest && focusRequest.at])
    }
    function usageChips(usage, t) {
      var items = [
        ['tokens.input', usage.inputTokens],
        ['tokens.output', usage.outputTokens],
        ['tokens.total', usage.totalTokens],
        ['tokens.cacheRead', usage.cacheReadTokens],
        ['tokens.cacheWrite', usage.cacheWriteTokens],
        ['tokens.reasoning', usage.reasoningTokens],
        ['tokens.sessions', usage.sessions],
      ]
      return items.map(function (item) {
        return h('span', { key: item[0], className: 'wtk-chip', 'data-brand': item[0] === 'tokens.total' ? 'true' : undefined },
          t(item[0]) + ' ' + formatInt(item[1]))
      })
    }
    function isKnownModel(model, snapshot) {
      if (!model || !snapshot || !snapshot.models) return false
      var providers = snapshot.models.providers || []
      for (var i = 0; i < providers.length; i += 1) {
        if (providers[i].id !== model.provider) continue
        var models = providers[i].models || []
        for (var j = 0; j < models.length; j += 1) {
          if (models[j].id === model.model) return true
        }
      }
      return false
    }
    function modelOptionNodes(snapshot, t) {
      var providers = (snapshot && snapshot.models && snapshot.models.providers) || []
      var nodes = [
        h('option', { key: 'follow', value: 'follow' }, t('model.followCurrent')),
        h('option', { key: 'custom', value: 'custom' }, t('model.custom')),
      ]
      providers.forEach(function (provider) {
        var models = provider.models || []
        if (!models.length) return
        nodes.push(h('optgroup', { key: 'p:' + provider.id, label: provider.name || provider.id },
          models.map(function (model) {
            return h('option', { key: 'm:' + provider.id + '/' + model.id, value: 'm:' + provider.id + '/' + model.id },
              model.name || model.id)
          })))
      })
      return nodes
    }
    // 颜色块：菜单与面板共用；展示用本地化颜色名 + 色块，不暴露色号。
    var SWATCHES = [
      { value: '#4f8cff', key: 'swatch.blue' },
      { value: '#2fb67c', key: 'swatch.green' },
      { value: '#e0a63c', key: 'swatch.amber' },
      { value: '#e05d5d', key: 'swatch.red' },
      { value: '#a06bf0', key: 'swatch.violet' },
      { value: '#3bb4c4', key: 'swatch.cyan' },
      { value: '#d377b8', key: 'swatch.pink' },
      { value: '#8a8f98', key: 'swatch.gray' },
    ]
    var COLOR_SWATCHES = SWATCHES.map(function (entry) { return entry.value })

    // ------------------------------------------------------------ 设置页：每工作区一行配置
    function WorkspaceSettingsRow(props) {
      var ws = props.workspace
      var snapshot = props.snapshot
      var backend = props.backend
      var t = props.t
      var notePair = React.useState(ws.note || '')
      var note = notePair[0]
      var setNote = notePair[1]
      var colorPair = React.useState(ws.color || '')
      var color = colorPair[0]
      var setColor = colorPair[1]
      var customPair = React.useState(function () { return !!(ws.model && !isKnownModel(ws.model, snapshot)) })
      var custom = customPair[0]
      var setCustom = customPair[1]
      var providerPair = React.useState(ws.model ? ws.model.provider : '')
      var provider = providerPair[0]
      var setProvider = providerPair[1]
      var modelPair = React.useState(ws.model ? ws.model.model : '')
      var modelName = modelPair[0]
      var setModelName = modelPair[1]
      var errorPair = React.useState('')
      var actionError = errorPair[0]
      var setActionError = errorPair[1]
      React.useEffect(function () { setNote(ws.note || '') }, [ws.note])
      React.useEffect(function () { setColor(ws.color || '') }, [ws.color])
      React.useEffect(function () {
        if (!ws.model) return
        setProvider(ws.model.provider)
        setModelName(ws.model.model)
        setCustom(!isKnownModel(ws.model, snapshot))
      }, [ws.model && ws.model.provider, ws.model && ws.model.model])
      function run(promise) {
        setActionError('')
        return Promise.resolve(promise).catch(function (reason) {
          setActionError(String((reason && reason.message) || reason))
        })
      }
      function patchMeta(patch) {
        return run(backend.patchMeta(ws.workspaceId, patch))
      }
      var known = isKnownModel(ws.model, snapshot)
      var selectValue = custom ? 'custom' : (ws.model ? (known ? 'm:' + ws.model.provider + '/' + ws.model.model : 'custom') : 'follow')
      function onSelectModel(event) {
        var value = event && event.target ? event.target.value : ''
        if (value === 'follow') {
          setCustom(false)
          patchMeta({ model: null })
          return
        }
        if (value === 'custom') {
          setCustom(true)
          return
        }
        if (value.indexOf('m:') === 0) {
          var rest = value.slice(2)
          var index = rest.indexOf('/')
          if (index <= 0) return
          setCustom(false)
          patchMeta({ model: { provider: rest.slice(0, index), model: rest.slice(index + 1) } })
        }
      }
      function applyCustom() {
        var nextProvider = String(provider || '').trim()
        var nextModel = String(modelName || '').trim()
        if (!nextProvider || !nextModel) {
          setActionError(t('model.invalid'))
          return
        }
        run(backend.patchMeta(ws.workspaceId, { model: { provider: nextProvider, model: nextModel } }))
          .then(function () { setCustom(false) })
      }
      function commitNote() {
        var next = String(note || '').trim()
        if (next === String(ws.note || '').trim()) return
        patchMeta({ note: next })
      }
      function commitColor(nextValue) {
        var next = String(nextValue || '').trim()
        if (next && !isSafeColor(next)) {
          setActionError(t('workspace.colorInvalid'))
          return
        }
        setActionError('')
        patchMeta({ color: next })
      }
      var modeLabel = ws.model
        ? ((known ? '' : '') + ws.model.provider + '/' + ws.model.model)
        : (snapshot.defaultModel ? t('model.followDefault', { model: snapshot.defaultModel.provider + '/' + snapshot.defaultModel.model }) : t('model.followCurrent'))
      return h('div', { className: 'wtk-ws-block', 'data-wtk-ws': ws.workspaceId },
        h('div', { className: 'wtk-row' },
          h('div', { className: 'wtk-row-main' },
            h('div', { className: 'wtk-row-title', style: ws.color && isSafeColor(ws.color) ? { color: ws.color } : undefined },
              ws.title || ws.path || ws.workspaceId,
              ws.note ? h('span', { className: 'wtk-row-sub' }, t('note.paren', { note: ws.note })) : null),
            h('div', { className: 'wtk-row-sub' }, ws.path || '')),
          h('div', { className: 'wtk-row-actions' },
            h('span', { className: 'wtk-chip', 'data-brand': ws.pinned ? 'true' : undefined }, ws.pinned ? t('pinned') : modeLabel),
            h('button', {
              type: 'button',
              className: 'wtk-icon-btn',
              title: ws.pinned ? t('workspace.unpin') : t('workspace.pin'),
              'aria-label': ws.pinned ? t('workspace.unpin') : t('workspace.pin'),
              'aria-pressed': ws.pinned ? 'true' : 'false',
              onClick: function () { patchMeta({ pinned: !ws.pinned }) },
            }, h(PluginGlyph, { size: 14 })))),
        h('div', { className: 'wtk-ws-config' },
          h('div', { className: 'wtk-field' },
            h('label', null, t('workspace.model')),
            h('select', { className: 'wtk-select', 'data-wtk-field': 'model', value: selectValue, onChange: onSelectModel },
              modelOptionNodes(snapshot, t))),
          h('div', { className: 'wtk-field' },
            h('label', null, t('workspace.note')),
            h('input', {
              className: 'wtk-input',
              'data-wtk-field': 'note',
              type: 'text',
              value: note,
              placeholder: t('note.placeholder'),
              onChange: function (event) { setNote(event && event.target ? event.target.value : '') },
              onBlur: commitNote,
              onKeyDown: function (event) { if (event && event.key === 'Enter') commitNote() },
            })),
          h('div', { className: 'wtk-field' },
            h('label', null, t('workspace.color')),
            h('div', { className: 'wtk-swatches', 'data-wtk-field': 'color' },
              SWATCHES.map(function (entry) {
                return h('button', {
                  key: entry.value,
                  type: 'button',
                  className: 'wtk-swatch',
                  title: t(entry.key),
                  'aria-label': t(entry.key),
                  'aria-pressed': (ws.color || '').toLowerCase() === entry.value ? 'true' : 'false',
                  'data-active': (ws.color || '').toLowerCase() === entry.value ? 'true' : undefined,
                  style: { backgroundColor: entry.value },
                  onClick: function () { setColor(entry.value); commitColor(entry.value) },
                })
              }),
              h('button', {
                type: 'button',
                className: 'wtk-btn',
                onClick: function () { setColor(''); commitColor('') },
              }, t('workspace.clearColor')))),
          h('div', { className: 'wtk-field' },
            h('label', null, t('workspace.colorCustom')),
            h('input', {
              className: 'wtk-input',
              'data-wtk-field': 'color-input',
              type: 'text',
              value: color,
              placeholder: 'var(--dsw-alias-brand-primary)',
              onChange: function (event) { setColor(event && event.target ? event.target.value : '') },
              onBlur: function () { commitColor(color) },
              onKeyDown: function (event) { if (event && event.key === 'Enter') commitColor(color) },
            }))),
        custom ? h('div', { className: 'wtk-ws-config' },
          h('div', { className: 'wtk-field' },
            h('label', null, t('model.customProvider')),
            h('input', {
              className: 'wtk-input', type: 'text', value: provider,
              onChange: function (event) { setProvider(event && event.target ? event.target.value : '') },
            })),
          h('div', { className: 'wtk-field' },
            h('label', null, t('model.customModel')),
            h('input', {
              className: 'wtk-input', type: 'text', value: modelName,
              onChange: function (event) { setModelName(event && event.target ? event.target.value : '') },
            })),
          h('div', { className: 'wtk-field' },
            h('label', null, '\u00a0'),
            h('button', { type: 'button', className: 'wtk-btn', 'data-primary': 'true', onClick: applyCustom }, t('model.apply')))) : null,
        h('div', { className: 'wtk-tokens-row' }, usageChips(workspaceUsage(ws), t)),
        actionError ? h('div', { className: 'wtk-error' }, t('action.failed', { message: actionError })) : null)
    }

    // ------------------------------------------------------------ 自定义模型供应商（设置页内分区）
    var PROVIDER_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    var PROVIDER_API_KEYS = {
      'openai-completions': 'providers.apiChatCompletions',
      'openai-responses': 'providers.apiResponses',
      'anthropic-messages': 'providers.apiAnthropic',
    }
    var PROVIDER_ROUTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
    function providerApiLabel(api, t) {
      return t(PROVIDER_API_KEYS[api] || 'providers.apiChatCompletions')
    }
    function emptyProviderForm() {
      return {
        editing: false,
        keyConfigured: false,
        route: '',
        displayName: '',
        api: 'openai-completions',
        baseURL: '',
        apiKey: '',
        apiKeyEnv: '',
        headers: [],
        models: [{ id: '', name: '', contextWindow: '', maxTokens: '', input: 'text' }],
      }
    }
    function providerToForm(provider) {
      var headers = []
      if (provider.headers && typeof provider.headers === 'object') {
        Object.keys(provider.headers).sort().forEach(function (name) {
          headers.push({ name: name, value: String(provider.headers[name] || '') })
        })
      }
      var models = (provider.models || []).map(function (model) {
        var input = model.input || []
        return {
          id: model.id || '',
          name: model.name || '',
          contextWindow: model.contextWindow ? String(model.contextWindow) : '',
          maxTokens: model.maxTokens ? String(model.maxTokens) : '',
          input: input.indexOf('image') >= 0 ? 'text,image' : 'text',
        }
      })
      if (!models.length) models = [{ id: '', name: '', contextWindow: '', maxTokens: '', input: 'text' }]
      return {
        editing: true,
        keyConfigured: provider.keyConfigured === true,
        route: provider.route,
        displayName: provider.displayName || '',
        api: PROVIDER_APIS.indexOf(provider.api) >= 0 ? provider.api : 'openai-completions',
        baseURL: provider.baseURL || '',
        apiKey: '',
        apiKeyEnv: provider.apiKeyEnv || '',
        headers: headers,
        models: models,
      }
    }
    function positiveInt(value) {
      var number = parseInt(String(value), 10)
      return isFinite(number) && number > 0 ? number : 0
    }
    function providerFormPatch(form) {
      var patch = {
        displayName: String(form.displayName || '').trim(),
        api: form.api,
        baseURL: String(form.baseURL || '').trim(),
      }
      var headers = {}
      var headerRows = form.headers || []
      headerRows.forEach(function (header) {
        var name = String(header.name || '').trim()
        if (!name) return
        headers[name] = String(header.value || '')
      })
      patch.headers = headers
      patch.models = (form.models || []).map(function (model) {
        var item = { id: String(model.id || '').trim() }
        var name = String(model.name || '').trim()
        if (name) item.name = name
        var contextWindow = positiveInt(model.contextWindow)
        if (contextWindow) item.contextWindow = contextWindow
        var maxTokens = positiveInt(model.maxTokens)
        if (maxTokens) item.maxTokens = maxTokens
        item.input = String(model.input || 'text') === 'text,image' ? ['text', 'image'] : ['text']
        return item
      })
      var apiKey = String(form.apiKey || '').trim()
      if (apiKey) patch.apiKey = apiKey
      var apiKeyEnv = String(form.apiKeyEnv || '').trim()
      if (apiKeyEnv) patch.apiKeyEnv = apiKeyEnv
      return patch
    }
    function validateProviderForm(form, t) {
      if (!PROVIDER_ROUTE_PATTERN.test(String(form.route || '').trim())) return t('providers.validationRoute')
      var hasModel = (form.models || []).some(function (model) { return String(model.id || '').trim() !== '' })
      if (!hasModel) return t('providers.validationModels')
      var baseURL = String(form.baseURL || '').trim()
      if (baseURL && !/^https?:\/\//i.test(baseURL)) return t('providers.validationBaseURL')
      return ''
    }
    function ProvidersSection(props) {
      var store = props.store
      var backend = props.backend
      var t = props.t
      var state = useStoreState(store)
      var snapshot = state.snapshot
      var custom = snapshot && snapshot.customProviders ? snapshot.customProviders : null
      var available = !!(custom && custom.available === true)
      var providers = (custom && custom.providers) || []
      var formPair = React.useState(null)
      var form = formPair[0]
      var setForm = formPair[1]
      var busyPair = React.useState('')
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var deletingPair = React.useState('')
      var deleting = deletingPair[0]
      var setDeleting = deletingPair[1]
      var feedbackPair = React.useState(null)
      var feedback = feedbackPair[0]
      var setFeedback = feedbackPair[1]
      var testPair = React.useState(null)
      var testState = testPair[0]
      var setTestState = testPair[1]
      React.useEffect(function () {
        if (!snapshot) return
        backend.loadProviders().catch(function () { /* 快照轮询会兜底刷新 */ })
      }, [snapshot && snapshot.ok])
      function eventValue(event) {
        return event && event.target ? event.target.value : ''
      }
      function openNew() {
        setFeedback(null)
        setTestState(null)
        setForm(emptyProviderForm())
      }
      function openEdit(provider) {
        setFeedback(null)
        setTestState(null)
        setForm(providerToForm(provider))
      }
      function closeForm() { setForm(null) }
      function updateField(field, value) {
        setForm(function (previous) {
          if (!previous) return previous
          var next = Object.assign({}, previous)
          next[field] = value
          return next
        })
      }
      function updateHeader(index, field, value) {
        setForm(function (previous) {
          if (!previous) return previous
          var headers = previous.headers.slice()
          headers[index] = Object.assign({}, headers[index], {})
          headers[index][field] = value
          return Object.assign({}, previous, { headers: headers })
        })
      }
      function addHeader() {
        setForm(function (previous) {
          if (!previous || previous.headers.length >= 20) return previous
          return Object.assign({}, previous, { headers: previous.headers.concat([{ name: '', value: '' }]) })
        })
      }
      function removeHeader(index) {
        setForm(function (previous) {
          if (!previous) return previous
          var headers = previous.headers.slice()
          headers.splice(index, 1)
          return Object.assign({}, previous, { headers: headers })
        })
      }
      function updateModel(index, field, value) {
        setForm(function (previous) {
          if (!previous) return previous
          var models = previous.models.slice()
          models[index] = Object.assign({}, models[index], {})
          models[index][field] = value
          return Object.assign({}, previous, { models: models })
        })
      }
      function addModel() {
        setForm(function (previous) {
          if (!previous || previous.models.length >= 40) return previous
          return Object.assign({}, previous, {
            models: previous.models.concat([{ id: '', name: '', contextWindow: '', maxTokens: '', input: 'text' }]),
          })
        })
      }
      function removeModel(index) {
        setForm(function (previous) {
          if (!previous) return previous
          var models = previous.models.slice()
          models.splice(index, 1)
          return Object.assign({}, previous, { models: models })
        })
      }
      function submitForm() {
        if (!form || busy) return
        var validation = validateProviderForm(form, t)
        if (validation) {
          setFeedback({ kind: 'error', text: validation })
          return
        }
        var route = String(form.route || '').trim()
        var patch = providerFormPatch(form)
        setBusy('save')
        setFeedback(null)
        Promise.resolve(backend.patchProvider(route, patch)).then(function () {
          setBusy('')
          setForm(null)
          setFeedback({ kind: 'notice', text: t('providers.saved') })
        }).catch(function (reason) {
          setBusy('')
          setFeedback({ kind: 'error', text: String((reason && reason.message) || reason) })
        })
      }
      function doDelete(route) {
        if (busy) return
        setBusy('delete')
        setFeedback(null)
        Promise.resolve(backend.patchProvider(route, { delete: true })).then(function () {
          setBusy('')
          setDeleting('')
          if (form && form.route === route) setForm(null)
          setFeedback({ kind: 'notice', text: t('providers.deleted') })
        }).catch(function (reason) {
          setBusy('')
          setFeedback({ kind: 'error', text: String((reason && reason.message) || reason) })
        })
      }
      function runTest(provider) {
        if (testState && testState.pending) return
        var route = provider.route
        var model = provider.models && provider.models[0] ? provider.models[0].id : ''
        setTestState({ route: route, pending: true, ok: false, text: t('providers.testing') })
        Promise.resolve(backend.testProvider(route, model)).then(function (data) {
          var status = data && data.status ? data.status : ''
          var latency = data && data.latencyMs ? data.latencyMs : 0
          if (data && data.ok) {
            setTestState({ route: route, pending: false, ok: true, text: t('providers.testOk', { status: status, latency: latency, detail: data.detail || '' }) })
            return
          }
          if (data && data.error) {
            setTestState({ route: route, pending: false, ok: false, text: t('providers.testNetwork', { error: data.error }) })
            return
          }
          setTestState({ route: route, pending: false, ok: false, text: t('providers.testFail', { status: status, latency: latency, error: (data && data.detail) || '' }) })
        }).catch(function (reason) {
          setTestState({ route: route, pending: false, ok: false, text: t('providers.testNetwork', { error: String((reason && reason.message) || reason) }) })
        })
      }
      function field(label, control, hint) {
        return h('div', { className: 'wtk-field' },
          h('label', null, label),
          control,
          hint ? h('div', { className: 'wtk-row-sub' }, hint) : null)
      }
      function renderHeaderRow(header, index) {
        return h('div', { className: 'wtk-edit-row', 'data-provider-header-row': 'true', key: 'header-' + index },
          h('input', {
            className: 'wtk-input', type: 'text', placeholder: t('providers.headerName'), value: header.name,
            onChange: function (event) { updateHeader(index, 'name', eventValue(event)) },
          }),
          h('input', {
            className: 'wtk-input', type: 'text', placeholder: t('providers.headerValue'), value: header.value,
            onChange: function (event) { updateHeader(index, 'value', eventValue(event)) },
          }),
          h('button', {
            type: 'button', className: 'wtk-icon-btn', title: t('providers.delete'), 'aria-label': t('providers.delete'),
            onClick: function () { removeHeader(index) },
          }, '\u00d7'))
      }
      function renderModelRow(model, index) {
        return h('div', { className: 'wtk-edit-row', 'data-provider-model-row': 'true', key: 'model-' + index },
          h('input', {
            className: 'wtk-input', type: 'text', placeholder: t('providers.modelId'), value: model.id,
            onChange: function (event) { updateModel(index, 'id', eventValue(event)) },
          }),
          h('input', {
            className: 'wtk-input', type: 'text', placeholder: t('providers.modelName'), value: model.name,
            onChange: function (event) { updateModel(index, 'name', eventValue(event)) },
          }),
          h('input', {
            className: 'wtk-input wtk-num', type: 'number', placeholder: t('providers.contextWindow'), value: model.contextWindow,
            onChange: function (event) { updateModel(index, 'contextWindow', eventValue(event)) },
          }),
          h('input', {
            className: 'wtk-input wtk-num', type: 'number', placeholder: t('providers.maxTokens'), value: model.maxTokens,
            onChange: function (event) { updateModel(index, 'maxTokens', eventValue(event)) },
          }),
          h('select', {
            className: 'wtk-select wtk-input-select', value: model.input,
            onChange: function (event) { updateModel(index, 'input', eventValue(event)) },
          },
            h('option', { value: 'text' }, t('providers.inputText')),
            h('option', { value: 'text,image' }, t('providers.inputTextImage'))),
          h('button', {
            type: 'button', className: 'wtk-icon-btn', title: t('providers.delete'), 'aria-label': t('providers.delete'),
            onClick: function () { removeModel(index) },
          }, '\u00d7'))
      }
      function renderForm() {
        if (!form) return null
        var editing = form.editing === true
        var headerRows = (form.headers || []).map(renderHeaderRow)
        var modelRows = (form.models || []).map(renderModelRow)
        var apiSelect = h('select', {
          className: 'wtk-select', value: form.api, 'data-provider-field': 'api',
          onChange: function (event) { updateField('api', eventValue(event)) },
        }, PROVIDER_APIS.map(function (api) {
          return h('option', { key: api, value: api }, providerApiLabel(api, t))
        }))
        return h('div', { className: 'wtk-provider-form', 'data-wtk-provider-form': 'true' },
          h('div', { className: 'wtk-provider-grid' },
            field(t('providers.route'),
              h('input', {
                className: 'wtk-input', type: 'text', placeholder: 'my-provider', 'data-provider-field': 'route',
                disabled: editing ? 'true' : undefined, value: form.route,
                onChange: function (event) { updateField('route', eventValue(event)) },
              }),
              editing ? t('providers.routeLocked') : t('providers.routeHint')),
            field(t('providers.displayName'),
              h('input', {
                className: 'wtk-input', type: 'text', 'data-provider-field': 'displayName', value: form.displayName,
                onChange: function (event) { updateField('displayName', eventValue(event)) },
              })),
            field(t('providers.api'), apiSelect),
            field(t('providers.baseURL'),
              h('input', {
                className: 'wtk-input', type: 'text', placeholder: 'https://…/v1', 'data-provider-field': 'baseURL', value: form.baseURL,
                onChange: function (event) { updateField('baseURL', eventValue(event)) },
              }),
              t('providers.baseURLHint')),
            field(t('providers.apiKey'),
              h('input', {
                className: 'wtk-input', type: 'password', autocomplete: 'new-password', 'data-provider-field': 'apiKey',
                placeholder: form.keyConfigured ? t('providers.apiKeyConfiguredPlaceholder') : t('providers.apiKeyPlaceholder'),
                value: form.apiKey,
                onChange: function (event) { updateField('apiKey', eventValue(event)) },
              })),
            field(t('providers.apiKeyEnvHint', { name: form.apiKeyEnv || '' }),
              h('input', {
                className: 'wtk-input', type: 'text', placeholder: 'MY_PROVIDER_API_KEY', 'data-provider-field': 'apiKeyEnv', value: form.apiKeyEnv,
                onChange: function (event) { updateField('apiKeyEnv', eventValue(event)) },
              }))),
          h('div', { className: 'wtk-field' },
            h('label', null, t('providers.headers')),
            h('div', { className: 'wtk-provider-rows' }, headerRows),
            h('div', { className: 'wtk-form-footer' },
              h('button', {
                type: 'button', className: 'wtk-btn', 'data-provider-add-header': 'true',
                disabled: (form.headers || []).length >= 20 ? 'true' : undefined,
                onClick: addHeader,
              }, t('providers.addHeader')))),
          h('div', { className: 'wtk-field' },
            h('label', null, t('providers.models')),
            h('div', { className: 'wtk-provider-rows' }, modelRows),
            h('div', { className: 'wtk-form-footer' },
              h('button', {
                type: 'button', className: 'wtk-btn', 'data-provider-add-model': 'true',
                disabled: (form.models || []).length >= 40 ? 'true' : undefined,
                onClick: addModel,
              }, t('providers.addModel')))),
          h('div', { className: 'wtk-form-footer' },
            h('button', {
              type: 'button', className: 'wtk-btn', 'data-primary': 'true', 'data-provider-save': 'true',
              disabled: busy ? 'true' : undefined,
              onClick: submitForm,
            }, t('providers.save')),
            h('button', { type: 'button', className: 'wtk-btn', onClick: closeForm }, t('providers.cancel'))))
      }
      function renderProvider(provider) {
        var modelsCount = (provider.models || []).length
        var testing = testState && testState.route === provider.route
        var keyDotTitle = (provider.apiKeyEnv || '') + ' · ' + t(provider.keyConfigured ? 'providers.keyConfigured' : 'providers.keyMissing')
        return h('div', { className: 'wtk-provider-block', 'data-provider': provider.route, key: provider.route },
          h('div', { className: 'wtk-provider-row' },
            h('div', { className: 'wtk-provider-main' },
              h('div', { className: 'wtk-row-title' }, provider.displayName || provider.route),
              h('div', { className: 'wtk-row-sub' },
                h('span', null, provider.route),
                provider.baseURL ? h('span', { className: 'wtk-provider-url', title: provider.baseURL }, ' ' + provider.baseURL) : null),
              h('div', { className: 'wtk-provider-meta' },
                h('span', { className: 'wtk-chip' }, t('providers.modelsCount', { count: modelsCount })),
                h('span', { className: 'wtk-chip' }, providerApiLabel(provider.api, t)),
                h('span', { className: 'wtk-key-dot', 'data-on': provider.keyConfigured ? 'true' : 'false', title: keyDotTitle }))),
            h('div', { className: 'wtk-row-actions' },
              h('button', { type: 'button', className: 'wtk-btn', 'data-provider-edit': 'true', onClick: function () { openEdit(provider) } }, t('providers.edit')),
              h('button', {
                type: 'button', className: 'wtk-btn', 'data-provider-test': 'true',
                disabled: testing && testState.pending ? 'true' : undefined,
                onClick: function () { runTest(provider) },
              }, t('providers.test')),
              deleting === provider.route
                ? h('span', { className: 'wtk-edit-row' },
                  h('button', {
                    type: 'button', className: 'wtk-btn', 'data-primary': 'true', 'data-provider-confirm-delete': 'true',
                    disabled: busy === 'delete' ? 'true' : undefined,
                    onClick: function () { doDelete(provider.route) },
                  }, t('providers.confirmDelete')),
                  h('button', { type: 'button', className: 'wtk-btn', onClick: function () { setDeleting('') } }, t('providers.cancel')))
                : h('button', { type: 'button', className: 'wtk-btn', 'data-provider-delete': 'true', onClick: function () { setDeleting(provider.route) } }, t('providers.delete')))),
          testing ? h('div', { className: 'wtk-test-line', 'data-ok': testState.ok ? 'true' : 'false', 'data-test-route': provider.route }, testState.text) : null,
          form && form.route === provider.route ? renderForm() : null)
      }
      var content
      if (!available) {
        content = h('div', { className: 'wtk-notice', 'data-provider-unavailable': 'true' }, t('providers.unavailable'))
      } else {
        content = h('div', null,
          providers.length === 0
            ? h('div', { className: 'wtk-empty', 'data-provider-empty': 'true' }, t('providers.empty'))
            : providers.map(renderProvider),
          h('div', { className: 'wtk-form-footer', style: { marginTop: '10px' } },
            h('button', {
              type: 'button', className: 'wtk-btn', 'data-primary': 'true', 'data-provider-add': 'true',
              onClick: openNew,
            }, t('providers.add'))),
          form && !providers.some(function (provider) { return provider.route === form.route }) ? renderForm() : null)
      }
      return h('div', { className: 'wtk-card wtk-providers', 'data-wtk-providers': 'true' },
        h('h3', null, t('providers.title')),
        h('div', { className: 'wtk-row-sub wtk-subhead' }, t('providers.desc')),
        content,
        feedback
          ? h('div', {
            className: feedback.kind === 'error' ? 'wtk-error' : 'wtk-notice',
            'data-provider-feedback': feedback.kind,
          }, feedback.text)
          : null)
    }

    // ------------------------------------------------------------ 设置页（settings.section）
    function SettingsPage(props) {
      var ctx = props.ctx
      var store = props.store
      var backend = props.backend
      var t = props.t
      var state = useStoreState(store)
      var snapshot = state.snapshot
      var focusRequest = useFocusRequest()
      useFocusEffect(focusRequest)
      React.useEffect(function () {
        // 进入管理界面才计算 Token 用量，平时不扫会话日志。
        backend.refresh(true).catch(function () {})
      }, [])
      function openOverview() {
        try {
          ctx.layout.selectPanel(PANEL_ID)
        } catch (error) {
          /* 面板尚未注册时静默降级 */
        }
      }
      if (!snapshot) {
        return h('div', { className: 'wtk-page' },
          h('div', null,
            h('h2', null, t('settings.title')),
            h('p', { className: 'wtk-desc' }, state.phase === 'error' ? t('status.loadFailed', { message: state.error }) : t('status.loading'))))
      }
      var workspaces = snapshot.workspaces || []
      return h('div', { className: 'wtk-page' },
        h('div', null,
          h('h2', null, t('settings.title')),
          h('p', { className: 'wtk-desc' }, t('settings.desc'))),
        h('div', { className: 'wtk-card' },
          h('h3', null, t('overview.global')),
          h('div', { className: 'wtk-row' },
            h('div', { className: 'wtk-row-main' }, h('div', { className: 'wtk-row-title' }, t('overview.title'))),
            h('div', { className: 'wtk-row-actions' },
              h('button', { type: 'button', className: 'wtk-btn', onClick: openOverview }, t('settings.openOverview'))))),
        h(ProvidersSection, { store: store, backend: backend, t: t }),
        h('div', { className: 'wtk-card' },
          h('h3', null, t('overview.workspaces')),
          h('div', { className: 'wtk-row-sub', style: { marginBottom: '8px' } }, t('overview.hint')),
          workspaces.length === 0
            ? h('div', { className: 'wtk-empty' }, t('overview.workspacesEmpty'))
            : workspaces.map(function (workspace) {
              return h(WorkspaceSettingsRow, {
                key: workspace.workspaceId,
                workspace: workspace,
                snapshot: snapshot,
                backend: backend,
                t: t,
              })
            })))
    }

    // ------------------------------------------------------------ 总览页（main keyed slot）
    function totalUsage(workspaces) {
      var total = emptyUsage()
      workspaces.forEach(function (workspace) {
        var usage = workspaceUsage(workspace)
        total.inputTokens += usage.inputTokens
        total.outputTokens += usage.outputTokens
        total.totalTokens += usage.totalTokens
        total.cacheReadTokens += usage.cacheReadTokens
        total.cacheWriteTokens += usage.cacheWriteTokens
        total.reasoningTokens += usage.reasoningTokens
        total.sessions += usage.sessions
      })
      return total
    }
    function modelText(workspace, snapshot, t) {
      if (workspace.model) return workspace.model.provider + '/' + workspace.model.model
      if (snapshot.defaultModel) return t('model.followDefault', { model: snapshot.defaultModel.provider + '/' + snapshot.defaultModel.model })
      return t('model.followShort')
    }
    function OverviewPage(props) {
      var store = props.store
      var backend = props.backend
      var t = props.t
      var decorator = props.decorator
      var state = useStoreState(store)
      var snapshot = state.snapshot
      var focusRequest = useFocusRequest()
      useFocusEffect(focusRequest)
      var errorPair = React.useState('')
      var actionError = errorPair[0]
      var setActionError = errorPair[1]
      React.useEffect(function () {
        // 进入管理界面才计算 Token 用量，平时不扫会话日志。
        backend.refresh(true).catch(function () {})
      }, [])
      function run(promise) {
        setActionError('')
        return Promise.resolve(promise).catch(function (reason) {
          setActionError(String((reason && reason.message) || reason))
        })
      }
      function callDecorator(name) {
        try {
          if (decorator && typeof decorator[name] === 'function') decorator[name]()
        } catch (error) {
          /* 装饰层不可用时静默降级 */
        }
      }
      var actions = h('div', { className: 'wtk-row-actions' },
        h('button', { type: 'button', className: 'wtk-btn', onClick: function () { callDecorator('expandAll') } }, t('sidebar.expandAll')),
        h('button', { type: 'button', className: 'wtk-btn', onClick: function () { callDecorator('collapseAll') } }, t('sidebar.collapseAll')),
        h('button', { type: 'button', className: 'wtk-btn', onClick: function () { run(backend.refresh(true)) } }, t('refresh')))
      if (!snapshot) {
        return h('div', { className: 'wtk-page' },
          h('div', null,
            h('h2', null, t('overview.title')),
            h('p', { className: 'wtk-desc' }, state.phase === 'error' ? t('status.loadFailed', { message: state.error }) : t('status.loading'))))
      }
      var workspaces = snapshot.workspaces || []
      var total = totalUsage(workspaces)
      return h('div', { className: 'wtk-page' },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' } },
          h('div', { style: { flex: '1 1 260px', minWidth: 0 } },
            h('h2', null, t('overview.title')),
            h('p', { className: 'wtk-desc' }, t('overview.desc'))),
          actions),
        h('div', { className: 'wtk-card' },
          h('h3', null, t('overview.summary')),
          h('div', { className: 'wtk-stat-grid' },
            h('div', { className: 'wtk-stat', title: formatInt(total.totalTokens) },
              h('div', { className: 'wtk-stat-label' }, t('tokens.total')),
              h('div', { className: 'wtk-stat-value' }, formatCompact(total.totalTokens))),
            h('div', { className: 'wtk-stat' },
              h('div', { className: 'wtk-stat-label' }, t('tokens.sessions')),
              h('div', { className: 'wtk-stat-value' }, formatInt(total.sessions))),
            h('div', { className: 'wtk-stat' },
              h('div', { className: 'wtk-stat-label' }, t('overview.workspacesCount')),
              h('div', { className: 'wtk-stat-value' }, formatInt(workspaces.length))),
            h('div', { className: 'wtk-stat' },
              h('div', { className: 'wtk-stat-label' }, t('tokens.input') + ' / ' + t('tokens.output')),
              h('div', { className: 'wtk-stat-value', title: formatInt(total.inputTokens) + ' / ' + formatInt(total.outputTokens) },
                formatCompact(total.inputTokens) + ' / ' + formatCompact(total.outputTokens))))),
        h('div', { className: 'wtk-card' },
          h('h3', null, t('settings.title')),
          h('div', { className: 'wtk-row-sub', style: { marginBottom: '8px' } }, t('overview.hint')),
          workspaces.length === 0
            ? h('div', { className: 'wtk-empty' }, t('overview.workspacesEmpty'))
            : workspaces.map(function (workspace) {
              return h(WorkspaceSettingsRow, {
                key: workspace.workspaceId,
                workspace: workspace,
                snapshot: snapshot,
                backend: backend,
                t: t,
              })
            })),
        h('div', { className: 'wtk-card' },
          h('h3', null, t('overview.usage')),
          workspaces.length === 0
            ? h('div', { className: 'wtk-empty' }, t('overview.workspacesEmpty'))
            : h('table', { className: 'wtk-table' },
              h('thead', null, h('tr', null,
                h('th', null, t('sidebar.section')),
                h('th', null, t('workspace.model')),
                h('th', null, t('pinned')),
                h('th', null, t('tokens.sessions')),
                h('th', null, t('tokens.input')),
                h('th', null, t('tokens.output')),
                h('th', null, t('tokens.total')))),
              h('tbody', null,
                workspaces.map(function (workspace) {
                  var usage = workspaceUsage(workspace)
                  return h('tr', { key: workspace.workspaceId },
                    h('td', null,
                      h('div', { style: workspace.color && isSafeColor(workspace.color) ? { color: workspace.color } : undefined },
                        workspace.title || workspace.path || workspace.workspaceId,
                        workspace.color && isSafeColor(workspace.color)
                          ? h('span', { style: { display: 'inline-block', width: '8px', height: '8px', marginLeft: '6px', borderRadius: '50%', backgroundColor: workspace.color } })
                          : null,
                        workspace.note ? h('span', { className: 'wtk-row-sub' }, t('note.paren', { note: workspace.note })) : null),
                      h('div', { className: 'wtk-row-sub' }, workspace.path || '')),
                    h('td', null, modelText(workspace, snapshot, t)),
                    h('td', null, workspace.pinned ? t('pinned') : ''),
                    h('td', null, String(usage.sessions || 0)),
                    h('td', null, formatInt(usage.inputTokens)),
                    h('td', null, formatInt(usage.outputTokens)),
                    h('td', null, formatInt(usage.totalTokens)))
                }),
                h('tr', { 'data-total': 'true' },
                  h('td', null, t('tokens.total')),
                  h('td', null, ''),
                  h('td', null, ''),
                  h('td', null, String(total.sessions)),
                  h('td', null, formatInt(total.inputTokens)),
                  h('td', null, formatInt(total.outputTokens)),
                  h('td', null, formatInt(total.totalTokens)))))),
        h('div', { className: 'wtk-footer' },
          h('span', null, snapshot.usageAt ? t('overview.lastUpdated', { time: formatTime(snapshot.usageAt) }) : ''),
          h('span', null, actionError ? t('action.failed', { message: actionError }) : '')))
    }

    // ------------------------------------------------------------ 追加式装饰层
    var ROW_SELECTOR = '[role="treeitem"][data-row-key^="workspace:"]'
    var HEADER_SELECTOR = '[class*="_sectionHeader"]'
    var LIST_AREA_SELECTOR = '[class*="_listArea"]'
    var PROJECT_TEXT_SELECTOR = '[class*="_projectText"]'
    var TITLE_SELECTOR = '[class*="_title"]'
    var DECO_ORDER = { pin: 0, note: 1, model: 2 }
    function cssAttrEscape(value) {
      return String(value == null ? '' : value).replace(/["\\]/g, '\\$&')
    }
    function toArray(list) {
      return Array.prototype.slice.call(list || [])
    }
    function createDecorator(ctx, store, backend, t, report, doc) {
      var d = doc || (typeof document !== 'undefined' ? document : null)
      var retryTimer = null
      var reprobeTimer = null
      var rafHandle = null
      var observer = null
      var observedTarget = null
      var unsubscribe = null
      var visibilityHandler = null
      var toggling = false
      var reportedMissing = false
      var disposed = false
      var lastStyleText = ''
      function qsa(root, selector) {
        if (!root || typeof root.querySelectorAll !== 'function') return []
        return toArray(root.querySelectorAll(selector))
      }
      function qs(root, selector) {
        if (!root || typeof root.querySelector !== 'function') return null
        return root.querySelector(selector)
      }
      function scheduleDecorate() {
        if (disposed) return
        if (rafHandle !== null) return
        var run = function () {
          rafHandle = null
          decorateNow()
        }
        if (typeof requestAnimationFrame === 'function') rafHandle = requestAnimationFrame(run)
        else rafHandle = setTimeout(run, 0)
      }
      function ensureObserver() {
        if (disposed) return
        if (typeof MutationObserver === 'undefined') return
        var target = qs(d, LIST_AREA_SELECTOR)
        if (observer && target === observedTarget) return
        if (observer) observer.disconnect()
        observer = new MutationObserver(function () { scheduleDecorate() })
        observedTarget = target
        if (target) {
          observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
        } else if (d && d.body) {
          observer.observe(d.body, { childList: true, subtree: true })
        }
      }
      function ensureStyleTag() {
        var tag = qs(d, 'style[data-wtk="styles"]')
        if (tag) return tag
        tag = d.createElement('style')
        tag.setAttribute('data-wtk', 'styles')
        tag.setAttribute('data-plugin-css', DECO_STYLE_ID)
        if (d.head) d.head.appendChild(tag)
        return tag
      }
      function syncStyleTag(workspaces) {
        var tag = ensureStyleTag()
        var rules = []
        workspaces.forEach(function (workspace) {
          if (!workspace || !workspace.color) return
          if (!isSafeColor(workspace.color)) return
          rules.push('[data-row-key="workspace:' + cssAttrEscape(workspace.workspaceId) + '"] [class*="_title"]{color:' + workspace.color.trim() + ';}')
        })
        var text = rules.join('\n')
        if (text === lastStyleText) return
        lastStyleText = text
        tag.textContent = text
      }
      function rowWorkspaceId(row) {
        var key = row.getAttribute('data-row-key') || ''
        return key.indexOf('workspace:') === 0 ? key.slice('workspace:'.length) : ''
      }
      function spanFor(container, kind, workspaceId) {
        var selector = '[data-wtk="' + kind + '"][data-wtk-for="' + cssAttrEscape(workspaceId) + '"]'
        return qs(container, selector)
      }
      function insertOrdered(container, node, kind) {
        // pin 的排序值是 0，不能用 || 兜底（0 为假值）。
        var order = DECO_ORDER[kind] === undefined ? 99 : DECO_ORDER[kind]
        var children = toArray(container.children)
        for (var i = 0; i < children.length; i += 1) {
          var child = children[i]
          var childKind = child.getAttribute ? child.getAttribute('data-wtk') : null
          if (!childKind) continue
          var childOrder = DECO_ORDER[childKind] === undefined ? 99 : DECO_ORDER[childKind]
          if (childOrder > order) {
            container.insertBefore(node, child)
            return
          }
        }
        container.appendChild(node)
      }
      function setSpanText(container, kind, workspaceId, text, titleText, className) {
        var existing = spanFor(container, kind, workspaceId)
        if (!text) {
          if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
          return
        }
        var node = existing
        if (!node) {
          node = d.createElement('span')
          node.setAttribute('data-wtk', kind)
          node.setAttribute('data-wtk-for', workspaceId)
          insertOrdered(container, node, kind)
        }
        if (className) {
          if (node.getAttribute('class') !== className) node.setAttribute('class', className)
        } else if (node.hasAttribute && node.getAttribute('class')) {
          node.removeAttribute('class')
        }
        if (node.textContent !== text) node.textContent = text
        if (titleText) {
          if (node.getAttribute('title') !== titleText) node.setAttribute('title', titleText)
        } else if (node.hasAttribute && node.hasAttribute('title')) {
          node.removeAttribute('title')
        }
      }
      // 置顶标记：12px pushpin，品牌色，与 note/tokens/model 同一容器内，排在标题之后。
      function pinIcon() {
        var svgNode = d.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svgNode.setAttribute('width', '12')
        svgNode.setAttribute('height', '12')
        svgNode.setAttribute('viewBox', '0 0 16 16')
        svgNode.setAttribute('fill', 'currentColor')
        svgNode.setAttribute('aria-hidden', 'true')
        var path = d.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', 'M9.7 1.5 14.5 6.3l-2.5.9-2.2 2.2-.5 2.9L4.9 8.1l2.9-.5 2.2-2.2Z')
        svgNode.appendChild(path)
        return svgNode
      }
      function syncPin(container, workspace) {
        var workspaceId = workspace.workspaceId
        var existing = spanFor(container, 'pin', workspaceId)
        if (!workspace.pinned) {
          if (existing && existing.parentNode) existing.parentNode.removeChild(existing)
          return
        }
        var node = existing
        if (!node) {
          node = d.createElement('span')
          node.setAttribute('data-wtk', 'pin')
          node.setAttribute('data-wtk-for', workspaceId)
          insertOrdered(container, node, 'pin')
        }
        var label = t('pinned')
        if (node.getAttribute('title') !== label) node.setAttribute('title', label)
        if (!node.getAttribute('aria-hidden')) node.setAttribute('aria-hidden', 'true')
        if (!qs(node, 'svg')) node.appendChild(pinIcon())
      }
      function decorateRow(row, workspace) {
        var projectText = qs(row, PROJECT_TEXT_SELECTOR)
        if (!projectText) return
        var title = qs(projectText, TITLE_SELECTOR)
        if (!title) return
        var noteText = workspace.note ? t('note.paren', { note: workspace.note }) : ''
        var modelTextValue = workspace.model && workspace.model.model ? truncate(workspace.model.model, 12) : ''
        syncPin(projectText, workspace)
        setSpanText(projectText, 'note', workspace.workspaceId, noteText, workspace.note ? workspace.note : '', '')
        setSpanText(projectText, 'model', workspace.workspaceId, modelTextValue,
          t('decorator.modelTitle') + ': ' + (workspace.model ? workspace.model.provider + '/' + workspace.model.model : ''), '')
      }
      // 展开 / 收起全部的图标：两个**同向** chevron（不要画成上下对称内扣的 ⌃⌄，14px 下会看成叉号 ✕）。
      function toggleIcon(collapsedExists) {
        var size = 16
        var svgNode = d.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svgNode.setAttribute('width', String(size))
        svgNode.setAttribute('height', String(size))
        svgNode.setAttribute('viewBox', '0 0 16 16')
        svgNode.setAttribute('fill', 'none')
        svgNode.setAttribute('stroke', 'currentColor')
        svgNode.setAttribute('stroke-width', '1.3')
        svgNode.setAttribute('stroke-linecap', 'round')
        svgNode.setAttribute('stroke-linejoin', 'round')
        svgNode.setAttribute('aria-hidden', 'true')
        // 有收起行 → 点击会「展开全部」：两个向下的 chevron；
        // 全部展开 → 点击会「收起全部」：两个向上的 chevron。
        var paths = collapsedExists
          ? ['M4.6 4.1L8 7.5l3.4-3.4', 'M4.6 8.5L8 11.9l3.4-3.4']
          : ['M4.6 11.9L8 8.5l3.4 3.4', 'M4.6 7.5L8 4.1l3.4 3.4']
        paths.forEach(function (spec) {
          var path = d.createElementNS('http://www.w3.org/2000/svg', 'path')
          path.setAttribute('d', spec)
          svgNode.appendChild(path)
        })
        return svgNode
      }
      function updateToggleButton(button, collapsedExists) {
        var label = collapsedExists ? t('decorator.toggleExpand') : t('decorator.toggleCollapse')
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
        if (button.getAttribute('title') !== label) button.setAttribute('title', label)
        var icon = qs(button, 'svg')
        if (icon && icon.parentNode) icon.parentNode.removeChild(icon)
        button.appendChild(toggleIcon(collapsedExists))
      }
      function decorateHeaders(collapsedExists) {
        var headers = qsa(d, HEADER_SELECTOR)
        headers.forEach(function (header) {
          var button = qs(header, 'button[data-wtk="toggle-all"]')
          if (!button) {
            button = d.createElement('button')
            button.setAttribute('type', 'button')
            button.setAttribute('data-wtk', 'toggle-all')
            button.addEventListener('click', function (event) {
              if (event && typeof event.preventDefault === 'function') event.preventDefault()
              if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
              toggleAll()
            })
            // 放在「工作区」标题右侧（紧跟 sectionLabel），而不是挤到最右边盖住搜索/视图按钮
            var label = qs(header, '[class*="_sectionLabel"]')
            if (label && label.parentNode === header) header.insertBefore(button, label.nextSibling)
            else header.appendChild(button)
          }
          updateToggleButton(button, collapsedExists)
        })
      }
      function collapseState(rows) {
        var collapsed = 0
        var expanded = 0
        rows.forEach(function (row) {
          var value = row.getAttribute('aria-expanded')
          if (value === 'false') collapsed += 1
          else if (value === 'true') expanded += 1
        })
        return { collapsed: collapsed, expanded: expanded }
      }
      function decorateNow() {
        if (disposed) return
        ensureObserver()
        var snapshot = store.get().snapshot
        var workspaces = (snapshot && snapshot.workspaces) || []
        var byId = {}
        workspaces.forEach(function (workspace) {
          if (workspace && workspace.workspaceId) byId[workspace.workspaceId] = workspace
        })
        syncStyleTag(workspaces)
        var rows = qsa(d, ROW_SELECTOR)
        rows.forEach(function (row) {
          var workspaceId = rowWorkspaceId(row)
          var workspace = byId[workspaceId]
          if (!workspace) return
          decorateRow(row, workspace)
        })
        var state = collapseState(rows)
        decorateHeaders(state.collapsed > 0)
      }
      function clickRows(rows) {
        if (toggling) return
        toggling = true
        try {
          rows.forEach(function (row) {
            row.setAttribute('data-wtk-clicking', '1')
            try {
              row.click()
            } catch (error) {
              /* 原生行不可点击时忽略 */
            }
            row.removeAttribute('data-wtk-clicking')
          })
        } finally {
          toggling = false
          scheduleDecorate()
        }
      }
      function expandAll() {
        var rows = qsa(d, ROW_SELECTOR)
        clickRows(rows.filter(function (row) { return row.getAttribute('aria-expanded') === 'false' }))
      }
      function collapseAll() {
        var rows = qsa(d, ROW_SELECTOR)
        clickRows(rows.filter(function (row) { return row.getAttribute('aria-expanded') === 'true' }))
      }
      function toggleAll() {
        if (toggling) return
        var rows = qsa(d, ROW_SELECTOR)
        var collapsed = rows.filter(function (row) { return row.getAttribute('aria-expanded') === 'false' })
        if (collapsed.length) clickRows(collapsed)
        else clickRows(rows.filter(function (row) { return row.getAttribute('aria-expanded') === 'true' }))
      }
      function attach() {
        if (disposed) return
        scheduleDecorate()
        if (store && typeof store.subscribe === 'function') unsubscribe = store.subscribe(scheduleDecorate)
        if (d && typeof d.addEventListener === 'function') {
          visibilityHandler = function () {
            if (!d.visibilityState || d.visibilityState === 'visible') {
              if (backend && typeof backend.refresh === 'function') backend.refresh(false).catch(function () {})
              scheduleDecorate()
            }
          }
          d.addEventListener('visibilitychange', visibilityHandler)
        }
        retryTimer = setTimeout(function () {
          retryTimer = null
          if (!observedTarget && !reportedMissing) {
            reportedMissing = true
            if (typeof report === 'function') {
              report('decorator:no-container', new Error('sidebar workspace list container not found'))
            }
            reprobeTimer = setTimeout(function () {
              reprobeTimer = null
              ensureObserver()
              scheduleDecorate()
            }, 30000)
          }
        }, 3000)
      }
      function dispose() {
        if (disposed) return
        disposed = true
        if (retryTimer !== null) clearTimeout(retryTimer)
        if (reprobeTimer !== null) clearTimeout(reprobeTimer)
        if (rafHandle !== null) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafHandle)
          else clearTimeout(rafHandle)
        }
        retryTimer = null
        reprobeTimer = null
        rafHandle = null
        if (unsubscribe) unsubscribe()
        unsubscribe = null
        if (observer) observer.disconnect()
        observer = null
        observedTarget = null
        if (d && typeof d.removeEventListener === 'function' && visibilityHandler) {
          d.removeEventListener('visibilitychange', visibilityHandler)
        }
        visibilityHandler = null
        qsa(d, '[data-wtk]').forEach(function (node) {
          if (node.parentNode) node.parentNode.removeChild(node)
        })
      }
      return {
        attach: attach,
        decorateNow: decorateNow,
        dispose: dispose,
        expandAll: expandAll,
        collapseAll: collapseAll,
        toggleAll: toggleAll,
      }
    }

    // ------------------------------------------------------------ 原生工作区右键菜单
    function findWorkspace(snapshot, workspaceId) {
      var workspaces = (snapshot && snapshot.workspaces) || []
      for (var i = 0; i < workspaces.length; i += 1) {
        if (workspaces[i] && workspaces[i].workspaceId === workspaceId) return workspaces[i]
      }
      return null
    }
    function openPanelField(ctx, workspaceId, field) {
      focusChannel.set({ workspaceId: workspaceId, field: field, at: Date.now() })
      try {
        ctx.layout.selectPanel(PANEL_ID)
      } catch (error) {
        /* 面板尚未注册时静默降级 */
      }
    }
    function workspaceMenuActions(ctx, store, backend, t, target) {
      var workspaceId = target && typeof target.workspaceId === 'string' ? target.workspaceId : ''
      if (!workspaceId) return []
      var snapshot = store.get().snapshot
      if (snapshot && snapshot.workspaces && !findWorkspace(snapshot, workspaceId)) return []
      var current = findWorkspace(snapshot, workspaceId) || {}
      var pinned = !!current.pinned
      return [
        {
          id: 'pin',
          label: pinned ? t('workspace.unpin') : t('workspace.pin'),
          icon: { key: pinned ? 'workspace.unpin' : 'workspace.pin' },
          separatorBefore: true,
          run: function () { return backend.patchMeta(workspaceId, { pinned: !(findWorkspace(store.get().snapshot, workspaceId) || {}).pinned }) },
          failureLabel: t('action.failedShort'),
        },
        {
          id: 'config',
          label: t('workspace.config'),
          icon: { key: 'workspace-toolkit.icon' },
          run: function () { openPanelField(ctx, workspaceId, '') },
          failureLabel: t('action.failedShort'),
        },
      ]
    }

    // ------------------------------------------------------------ 槽位组件
    function createSettingsIconComponent() {
      return function SettingsIcon(props) {
        return h(PluginGlyph, { size: props.size || 16 })
      }
    }
    function createPageComponent(ctx, store, backend, decorator, mode) {
      return function Page(props) {
        var t = props.t || ctx.locale.bind(NS)
        // 原生 main 槽的容器是 `flex:1;min-height:0` 且外层 overflow:hidden，
        // 所以插件必须自己撑满高度并管理滚动，否则内容会被裁掉且无法滚动。
        var content = mode === 'settings'
          ? h(SettingsPage, { ctx: ctx, store: store, backend: backend, t: t })
          : h(OverviewPage, { store: store, backend: backend, decorator: decorator, t: t })
        return h('div', { className: 'wtk-root', 'data-inline': mode === 'settings' ? 'true' : undefined },
          h('div', { className: 'wtk-scroll' }, content))
      }
    }

    // ------------------------------------------------------------ 插件
    function apply(ctx) {
      var store = createStore()
      var backend = createBackend(ctx, store)
      // 诊断：槽位注册/装饰层失败时回传给 Host，便于在无浏览器控制时排查。
      var clientErrors = []
      var reported = false
      function noteClientError(label, error) {
        try {
          clientErrors.push({
            label: label,
            message: String((error && error.stack) || (error && error.message) || error),
          })
        } catch (ignored) { /* 忽略诊断自身错误 */ }
      }
      function reportClient() {
        if (reported) return
        reported = true
        try {
          fetch(ROUTE_PREFIX + '/client-report', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              applied: true,
              errors: clientErrors,
              at: new Date().toISOString(),
              href: typeof location !== 'undefined' ? location.href : '',
            }),
            keepalive: true,
          }).catch(function () {})
        } catch (ignored) { /* 忽略上报失败 */ }
      }
      function safe(fn, label) {
        try {
          return fn()
        } catch (error) {
          noteClientError(label, error)
          return undefined
        }
      }
      // 词典 + 翻译：locale 服务不可用时组件仍可用中文兜底。
      safe(function () {
        ctx.effect(function localeDictionaries() {
          return ctx.locale.register(NS, { zh: ZH, en: EN })
        }, PKG_ID + ': locale')
      }, 'locale.register')
      var t
      try {
        t = ctx.locale.bind(NS)
      } catch (error) {
        noteClientError('locale.bind', error)
        t = function (key, params) {
          var template = ZH[key] || EN[key] || key
          if (!params) return template
          return template.replace(/\{(\w+)\}/g, function (match, name) {
            return name in params ? String(params[name]) : match
          })
        }
      }
      // 样式表：插件卸载时移除。
      safe(function () {
        ctx.effect(function stylesheet() {
          var stale = document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')
          if (stale && stale.parentNode) stale.parentNode.removeChild(stale)
          var tag = document.createElement('style')
          tag.setAttribute('data-plugin', PKG_ID)
          tag.setAttribute('data-plugin-css', STYLE_ID)
          tag.textContent = STYLE_TEXT
          document.head.appendChild(tag)
          return function removeStylesheet() {
            if (tag.parentNode) tag.parentNode.removeChild(tag)
          }
        }, PKG_ID + ': stylesheet')
      }, 'stylesheet')
      // 装饰层：只 append 自建节点，observer/timer 全部在 effect 内清理。
      var decorator = safe(function () {
        return createDecorator(ctx, store, backend, t, noteClientError)
      }, 'decorator.create')
      if (decorator) {
        safe(function () {
          ctx.effect(function decoratorLifecycle() {
            decorator.attach()
            return function stopDecorator() { decorator.dispose() }
          }, PKG_ID + ': decorator')
        }, 'decorator.effect')
      }
      if (!React || typeof React.createElement !== 'function') {
        noteClientError('react', new Error('react is unavailable; UI slots were skipped'))
        reportClient()
        return
      }
      // 后台预取一次快照，侧边栏入口不需要等面板挂载。
      backend.refresh(false).catch(function () {})
      // 3 个客户端槽位 + 1 个右键菜单图标 keyed 槽：全部在 apply 生命周期内注册。
      safe(function () {
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({ name: 'settings.section', id: 'workspace-toolkit', order: 60, label: function () { return t('settings.nav') }, locale: NS }, createPageComponent(ctx, store, backend, decorator, 'settings'))
        })
      }, 'slot:settings.section')
      safe(function () {
        ctx.slots.inject('settings.section.icon', function () {
          return ctx.slots.register({ name: 'settings.section.icon', id: 'workspace-toolkit', order: 60, label: function () { return t('settings.nav') } }, createSettingsIconComponent())
        })
      }, 'slot:settings.section.icon')
      safe(function () {
        ctx.slots.inject('main', function () {
          return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, createPageComponent(ctx, store, backend, decorator, 'overview'))
        })
      }, 'slot:main')
      // 右键菜单图标：context-menu 包声明的 keyed slot，按 action.icon.key 匹配。
      safe(function () {
        ctx.slots.inject('contextMenu.icon', function* () {
          yield ctx.slots.register({ name: 'contextMenu.icon', key: 'workspace-toolkit.icon' }, PluginGlyph)
        })
      }, 'slot:contextMenu.icon')
      // 原生工作区气泡菜单（省略号打开）：置顶 / 备注 / 标题颜色 / 模型。
      safe(function () {
        ctx.effect(function workspaceContextMenu() {
          return ctx.contextMenus.register({
            id: 'workspace-toolkit.workspace-actions',
            target: 'workspace',
            order: 110,
            resolve: function (target) { return workspaceMenuActions(ctx, store, backend, t, target) },
          })
        }, PKG_ID + ': workspace-context-menu')
      }, 'context-menu:workspace-actions')
      // 注册阶段结束后，把收集到的失败信息上报一次。
      safe(function () {
        ctx.effect(function clientErrorReporter() {
          var timer = setTimeout(reportClient, 1500)
          return function stopReporter() { clearTimeout(timer) }
        }, PKG_ID + ': client report')
      }, 'client-report')
    }
    module.exports = { name: PKG_ID, inject: inject, apply: apply }
    return module.exports
  },
})
