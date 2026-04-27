<img src="assets/icons/icon.png" alt="logo" title="feishin" align="right" height="60px" width="60px" />

# Feishin（中文说明）

本项目是 [Sonixd](https://github.com/jeffvli/sonixd) 的重写版。Feishin 是一个现代的自托管音乐播放器客户端，支持 **MPV** 和 **Web** 两种播放后端。

> 说明：英文原版说明见 `README.md`。中文文档以“关键使用/开发流程”为主，避免全文翻译带来的维护成本。

## 特性

- 支持 MPV 播放后端
- 支持 Web 播放后端
- 现代 UI
- 播放记录回传（scrobble）到服务器
- 智能歌单编辑器（Navidrome）
- 同步/非同步歌词

## 快速开始

### 桌面端（推荐）

从 Releases 下载桌面客户端。桌面端同时支持 MPV 与 Web 播放后端，并内置歌词获取能力。

### Web / Docker

Web 版本仅支持 Web 播放后端。Docker 镜像托管在 `ghcr.io`。

## 配置

1) 首次启动后，配置服务器（Navidrome / Jellyfin / Subsonic/OpenSubsonic 兼容 API）。

2) （可选）配置 MPV 可执行文件路径：
   - 如果你使用的是我们自用 fork 的增强版本，Windows 安装包会尝试内置 `mpv.exe`（零配置优先）。
   - 高级用户也可以在设置里指定 `mpv_path`，使用自编译版本或自定义版本。

## 常见问题（FAQ）

### MPV 无法播放或播放状态频繁切换

优先检查 MPV 二进制路径是否正确：

- Windows：确认设置中的 MPV 可执行文件路径指向正确的 `mpv.exe`，或使用本仓库提供的 dev 脚本准备 `resources/mpv/mpv.exe`。

## 开发（Development）

使用 Node `v23.11.0` 测试。

本项目基于 [electron-vite](https://github.com/alex8088/electron-vite)。

### MPV 二进制（dev/worktree 重要）

发布版本会把 MPV 打包进安装包；但在开发模式（尤其是 git worktree）下，仓库里可能默认没有 `resources/mpv/mpv.exe`。

当 MPV 缺失时，Feishin 会回退到系统 `PATH` 查找 `mpv`；如果系统没装 mpv，则会导致：

- MPV 播放失败（可能 fallback 到 Web 播放器）
- 音频设备列表无法枚举（依赖 MPV 实例读取 `audio-device-list`）

因此建议在开发前先执行一次脚本准备 MPV：

- Windows：

```powershell
.\scripts\setup-mpv.ps1
```

- macOS/Linux（首次需要 chmod）：

```bash
chmod +x scripts/setup-mpv.sh
./scripts/setup-mpv.sh
```

### 常用命令

- `pnpm run dev`：启动开发模式
- `pnpm run build`：构建桌面端
- `pnpm run package:win`：本地打 Windows 安装包
- `pnpm run typecheck:web`：web 侧类型检查

## 许可证

GPL-3.0（详见 `LICENSE`）。

