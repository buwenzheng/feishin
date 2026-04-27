# Windows 内置 MPV（二进制）方案设计

## 目标

- **用户零配置**：默认不需要手动选择 `mpv.exe`，MPV 播放与设备列表可直接工作。
- **可重复构建**：在 GitHub Actions（Windows）上可稳定打包出包含 MPV 的安装包/压缩包。
- **可覆盖**：高级用户仍可通过设置 `mpv_path` 指向自定义 mpv（例如自编译版）。
- **最小维护成本**：不把大型二进制长期提交到仓库主分支（避免仓库膨胀与 LFS 维护）。

范围：仅 Windows；仅考虑 mpv 作为外部进程（node-mpv）。

## 事实与约束

- 当前项目 `electron-builder.yml` 已配置：
  - `extraResources: from: resources/mpv -> to: mpv`（打包时会把 `resources/mpv` 放到 `process.resourcesPath/mpv`）
- 当前主进程 `getMpvBinaryPath()` 的优先级为：
  1) `mpv_path`（用户设置）
  2) `process.resourcesPath/mpv/mpv.exe`（打包资源）
  3) `app.getAppPath()/resources/mpv/mpv.exe`（开发模式）
  4) PATH 查找（`mpv`）
- Worktree 开发时常见问题：worktree 目录没有 `resources/mpv/mpv.exe`，PATH 也没有 `mpv`，导致播放与设备枚举失败。

## 方案总览（已确认）

选择：**CI 构建时下载固定版本 MPV**（而不是把二进制提交进仓库）。

### 核心策略

1. **运行时**：优先使用打包内置 MPV（`process.resourcesPath/mpv/mpv.exe`），用户无需设置。
2. **CI 构建时**：在 Windows workflow 中下载 mpv 并放入 `resources/mpv/`，让 electron-builder 打包进 `extraResources`。
3. **开发时（可选增强）**：若缺少 `resources/mpv/mpv.exe` 且未设置 `mpv_path`，给出明确提示（并引导一键下载/复制）。此增强可后续再做，不作为本轮必须项。

## GitHub Actions（Windows）打包设计

### 输入

- `MPV_VERSION`：mpv 版本（例如 `0.41.0`）
- `MPV_SOURCE`：下载源（建议固定一个可用源）
- `MPV_SHA256`：可选（推荐），对下载包做校验，保证可重复与安全

### 步骤（高层）

1) Cache 目录 `resources/mpv`（已存在）  
2) Cache miss 时：
   - 下载 mpv zip/7z
   - 校验（可选，但建议）
   - 解压到 `resources/mpv/`
3) `pnpm run publish:win`（electron-builder 打包时会携带 `resources/mpv/**`）

### 输出

最终包内应存在：

- `<installDir>/resources/mpv/mpv.exe`（即 `process.resourcesPath/mpv/mpv.exe`）

## 本地 Git 代理（仅本项目 push/pull）

约束：不改全局 git config。

建议做法：在 README 或 `scripts/` 提供便捷命令（每次命令级代理）：

- `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 pull`
- `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push`

（仅影响该次命令；满足“只在当前项目下用”。）

## 验收标准（Acceptance Criteria）

1) Windows 打包产物包含 `resources/mpv/mpv.exe`，且应用默认无需设置 `mpv_path` 即可启动 MPV 播放。
2) GitHub Actions 在你的 fork 上能够完成 Windows 打包（即便 runner 环境没有预装 mpv）。
3) 对大陆网络：提供“命令级代理”的 push/pull 方式，不修改全局 git 设置。

