# 项目协作约定

## 语言

- 始终使用简体中文回复用户。

## “发版”标准流程

用户说“发版”（或表达发布新版本、发布当前代码）时，即视为授权执行以下完整流程，无需再次确认是否推送 `main`、创建标签或发布 npm。仅当出现合并冲突、发布凭据失效、版本已存在等阻塞问题时停止并报告。

项目发布信息：

- GitHub 仓库：`origin/main`
- npm 包：`@ylhsweet/dsh-workspace-toolkit`
- 发布分支：`main`
- 版本标签：`v<package.json version>`
- npm dist-tag：`latest`

### 1. 同步最新代码

1. 执行 `git status --short --branch`，确认当前分支、远端跟踪状态和本地改动。
2. 执行 `git fetch origin --prune`，再以 `git pull --ff-only origin main` 快进同步。
3. 工作区有未提交改动时，先用 `git stash push -u -m "pre-release-<时间>"` 保存，再同步代码并执行 `git stash pop` 恢复；不得丢弃用户改动。
4. 出现冲突或无法安全恢复时停止发版，保留现场并报告，不得重置或强制覆盖工作区。

### 2. 确定版本

1. 读取 `package.json` 版本，并执行 `npm view @ylhsweet/dsh-workspace-toolkit version dist-tags --json` 确认 npm 已发布版本。
2. 用户未指定版本时按语义化版本升级：
   - 修复、文档、重构、发布元数据：patch。
   - 向后兼容的新功能：minor。
   - 不兼容变更：major。
3. 使用 `npm version <version> --no-git-tag-version` 更新版本；若对应版本已发布或标签已存在，停止并报告。

### 3. 发布前验证

1. 执行 `npm test`，要求全部通过。
2. 执行 `npm pack --dry-run --json`，核对包名、版本、入口文件、运行时资源及 `files` 清单，确保不漏文件且不包含密钥或临时文件。
3. 执行 `git diff --check`，检查空白和补丁错误。
4. 任何验证失败都不得发布；修复后重新执行完整验证。

### 4. 提交并推送源码

1. 只暂存本次发版相关文件，禁止把无关的本地改动带入发布提交。
2. 使用中文 Conventional Commits，提交标题采用 `chore(release): 发布 v<version>`，正文列出用户可见变更和发布配置调整。
3. 提交后执行 `git push -u origin main`。只允许普通快进推送，禁止 `--force`。
4. 推送失败时保留原始错误，先同步远端并解决差异，不得强推。

### 5. 发布 npm

1. 执行 `npm publish --access public`；`prepublishOnly` 会再次运行测试，若失败则停止。
2. 发布后核对 registry，直至以下信息可查询：

   ```powershell
   npm view @ylhsweet/dsh-workspace-toolkit@<version> version dist.tarball dist.shasum dist.integrity --json
   npm view @ylhsweet/dsh-workspace-toolkit dist-tags --json
   ```

3. 必须确认 `latest` 指向新版本，且 registry 的 shasum/integrity 与本地发布包一致。
4. npm 有传播延迟时轮询等待；不得因暂时 404 重复执行发布。若出现 2FA、权限或版本冲突，按原错误报告。

### 6. 创建 Git 标签和 GitHub Release

1. 在已推送的发布提交上创建附注标签：

   ```powershell
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```

2. 确认 `gh auth status` 可用，然后执行：

   ```powershell
   gh release create v<version> --verify-tag --title "v<version>" --notes "<发布说明>"
   ```

3. 发布说明用中文，列出本次实际变更、npm 包名版本和安装命令；不得写入凭据、内部路径或未验证内容。

### 7. 完成后校验与汇报

1. 校验远端分支、标签和 GitHub Release：

   ```powershell
   git status --short --branch
   git ls-remote --tags origin "refs/tags/v<version>"
   gh release view v<version>
   ```

2. 最终汇报需要包含：拉取的远端提交、发布版本、测试结果、npm 包与 `latest` 状态、发布提交哈希、Git 标签和 GitHub Release 链接。
3. 发版结束后工作区应保持干净；若存在用户原有的无关改动，明确列出但不得擅自提交。
