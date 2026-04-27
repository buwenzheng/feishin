# Windows 内置 MPV（二进制）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows GitHub Actions 打包流程中自动下载并打包内置 MPV（二进制），让用户默认零配置可用，同时保留 `mpv_path` 覆盖能力；并提供仅对本项目生效的 git 代理使用方式。

**Architecture:** 复用现有 `electron-builder.yml` 的 `extraResources(from: resources/mpv -> to: mpv)`，在 Windows workflow 中确保构建前 `resources/mpv/mpv.exe` 存在（cache + download + 可选校验）。运行时优先使用 `process.resourcesPath/mpv/mpv.exe`。

**Tech Stack:** GitHub Actions (Windows) + PowerShell + electron-builder + node-mpv (外部 mpv)

---

## File Structure

- Modify: `.github/workflows/publish-windows.yml`（或你最终用于 Windows 打包的 workflow）
- (Optional) Modify: `README.md`（写 git 代理命令示例）
- (Optional) Create: `scripts/git-with-proxy.ps1`（便捷脚本，命令级代理）

---

### Task 1: 固化 MPV 下载/缓存步骤（Windows workflow）

**Files:**
- Modify: `.github/workflows/publish-windows.yml`

- [ ] **Step 1: 定义可维护的 MPV 版本变量**

在 workflow 顶部加入 `env`（示例）：

```yaml
env:
  MPV_VERSION: "0.41.0"
```

- [ ] **Step 2: 保留并调整 cache key**

将 cache key 与版本绑定（已存在 `mpv-shinchiro-v0.41.0`，建议改成引用 env）：

```yaml
key: mpv-${{ env.MPV_VERSION }}-windows
```

- [ ] **Step 3: 将“下载 mpv”步骤改为可重复且不依赖 Chocolatey（推荐）**

用固定 URL 下载 zip 并解压到 `resources/mpv`（示例步骤骨架；实现时填入具体 URL 与校验策略）：

```yaml
- name: Download MPV binary (Windows)
  if: steps.cache-mpv.outputs.cache-hit != 'true'
  shell: pwsh
  run: |
    $ErrorActionPreference = 'Stop'
    New-Item -ItemType Directory -Path "resources/mpv" -Force | Out-Null
    # TODO: 下载 zip 到临时目录
    # TODO: 可选 sha256 校验
    # TODO: 解压并确保 resources/mpv/mpv.exe 存在
    if (!(Test-Path "resources/mpv/mpv.exe")) { throw "mpv.exe not found after download" }
```

> 若你更愿意沿用 Chocolatey（当前实现），也可先保留，但长期可重复性与源稳定性较弱。

- [ ] **Step 4: 增加“构建前断言”**

在 `pnpm run publish:win` 之前增加：

```yaml
- name: Assert MPV exists
  shell: pwsh
  run: |
    if (!(Test-Path "resources/mpv/mpv.exe")) { throw "resources/mpv/mpv.exe missing" }
```

- [ ] **Step 5: 运行一次 workflow（手动触发）**

在 GitHub UI 手动触发 workflow，观察：
- cache 命中/未命中两条路径都可成功
- 产物包含 mpv（见 Task 2 验证）

---

### Task 2: 验证打包产物内置 mpv 可用

**Files:**
- 无（主要是验证）

- [ ] **Step 1: 下载 Windows 打包产物并解压/安装**

- [ ] **Step 2: 验证 mpv 资源路径**

检查安装目录（或解压目录）是否包含：

- `resources/mpv/mpv.exe`

- [ ] **Step 3: 运行应用验证零配置**

不设置 `mpv_path`：
- MPV 播放正常
- 音频设备列表可枚举

---

### Task 3: Git 代理（仅本项目 push/pull）便捷方案

**Files:**
- (Optional) Modify: `README.md`
- (Optional) Create: `scripts/git-proxy-push.ps1`, `scripts/git-proxy-pull.ps1`

- [ ] **Step 1: 选择落地方式**

两种都满足“不改全局”：

- 文档方式（最低成本）：README 提供命令示例
- 脚本方式（更友好）：提供 `scripts/*.ps1`，用户只需运行脚本

- [ ] **Step 2: 给出命令级代理示例（HTTP 127.0.0.1:7890）**

```powershell
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 pull
git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

- [ ] **Step 3: 验证 push/pull 可用**

在代理开启时执行上述命令，确保能连通 GitHub。

---

## Self-Review

- 覆盖 spec：workflow 下载/缓存 + 产物验证 + git 命令级代理 ✅
- 占位符：Task 1 Step 3 的 URL/sha256 需要在实现阶段具体化（实现时必须补齐）✅

