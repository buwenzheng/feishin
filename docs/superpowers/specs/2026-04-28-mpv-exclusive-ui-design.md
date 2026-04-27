# MPV 独占模式（WASAPI Exclusive）UI/交互设计（Windows）

## 背景与目标

用户目标：在 Windows 上使用 **WASAPI 独占模式** 获得更好的音质（HiFi/bit‑perfect 方向），同时避免 UI 误导（例如 DirectSound/WaveOut 也能“独占”）。

本设计覆盖：

- **独占模式配置的可见性规则**（仅在 WASAPI 后端下展示）
- **“变更需重载 MPV 才生效”的提示条**（不自动重载，但提供一键重载）
- **CLI 参数生效边界**（哪些必须重启 MPV 实例）

不覆盖：

- 音质算法参数（例如重采样细节）
- 设备枚举/选择的产品化（仅保持现有）

## 事实约束（第一性原理）

### Windows 独占的语义

- Windows 上“独占”(exclusive) 的常见用户语义基本等同于 **WASAPI Exclusive Stream**。
- `directsound` / `waveout` 属于共享/混音路径或旧式输出路径，不具备现代 WASAPI 独占语义。
- `auto` 会让 mpv 自行选择 AO/设备，无法在 UI 层保证它一定走 WASAPI，更无法保证独占。

### mpv 参数生效范围

在本项目中，后端/独占等属于 **mpv 启动 CLI 参数**：

- `--ao=...`（输出后端）
- `--audio-exclusive=yes|no`（仅对 WASAPI 语义有效）
- `--wasapi-exclusive-buffer=...`（仅对 WASAPI + 独占开启有效）

这类参数通常需要 **重启 MPV 实例** 才生效；仅通过运行时 `setProperty` 不可靠/不可用（项目里 `getMpvSetting()` 对这些返回 `{}` 也印证了这一点）。

## 当前代码现状（与本设计直接相关）

- `src/renderer/features/settings/components/playback/mpv-settings.tsx`
  - `audioOutputBackend` 选择项存在（auto/wasapi/dsound/waveout）
  - `audioExclusiveMode` 开关目前 **在 LOCAL 下总是显示**（仅 isHidden=type!==LOCAL）
  - `wasapiExclusiveBuffer` 仅在 `audioExclusiveMode==='yes'` 时显示，但未绑定后端
  - Reload 通过 `eventEmitter.emit('MPV_RELOAD')` 触发重启
- `src/renderer/features/settings/components/playback/mpv-properties.ts`
  - CLI 参数生成：只有 `audioOutputBackend==='wasapi'` 才会加入 `--audio-exclusive=...` 与 `--wasapi-exclusive-buffer=...`
  - 这意味着：即使 UI 展示了独占，在非 WASAPI 下也不会真正生效（存在误导风险）

## 设计决策（已确认）

### D1. 独占配置仅在 WASAPI 下可见

用户已选择策略：**只有当 `audioOutputBackend === 'wasapi'` 时，才显示独占相关配置**。

具体规则：

- 当 `settings.mpvProperties.audioOutputBackend !== 'wasapi'`：
  - 隐藏 `audioExclusiveMode`（独占开关）
  - 隐藏 `wasapiExclusiveBuffer`
  - 隐藏 `wasapiExclusiveBufferUs`
- 当 `audioOutputBackend === 'wasapi'`：
  - 显示 `audioExclusiveMode`
  - 若 `audioExclusiveMode === 'yes'`：显示 buffer 相关项

说明：隐藏而非置灰，避免“其它后端也支持独占”的暗示。

### D2. 修改后端/独占后不自动重载，但提示并提供一键重载

用户已选择策略：**不自动重启 MPV**；通过提示条引导用户主动点击。

触发条件（任一发生即进入“待应用”状态）：

- `audioOutputBackend` 变化
- `audioExclusiveMode` 变化（仅在 wasapi 下可见，但即便存量值变化也计入）
- `wasapiExclusiveBuffer` / `wasapiExclusiveBufferUs` 变化（仅 wasapi + exclusive=yes 可见）

提示条行为：

- 显示位置：`MpvSettings` 的通用设置区域（audio backend / exclusive 配置附近）
- 文案（中文为主，i18n 键后续实现时补齐）：
  - **“音频后端/独占设置需要重载 MPV 才会生效。”**
  - 按钮：**“重载 MPV”**
- 点击按钮：
  - 触发当前已有的 `handleReloadMpv()`（内部 `mediaStop({reset:false})` + emit `MPV_RELOAD`）
  - 重载成功后清除“待应用”状态（提示条消失）

### D3. 状态保持原则

- **不改变用户现有设置值的存储方式**：即使当前后端不是 wasapi，`audioExclusiveMode` 等字段仍可保存在设置中，只是 UI 不展示/不生效。
- 当用户切回 wasapi 时，恢复展示并沿用已保存值（例如之前开了独占，切回后开关仍为开）。

## 方案备选（记录但不采用）

1) 永远显示独占但非 WASAPI 置灰 + 提示  
优点：可发现性更强；缺点：仍可能让用户误以为“能用只是暂不可用”，与 HiFi 目标的“准确性”冲突。

2) auto 下也展示独占并提示“auto 可能不生效”  
优点：少一步切换；缺点：依然存在误导和不可验证性（是否真正独占不确定）。

## 需要新增/调整的实现点（仅规格，不是实现）

### UI（`mpv-settings.tsx`）

- 调整 `audioExclusiveMode` / `wasapiExclusiveBuffer` / `wasapiExclusiveBufferUs` 的 `isHidden`：
  - 增加 `audioOutputBackend === 'wasapi'` 约束
- 增加“待应用”提示条组件（复用现有 UI 组件体系，避免引入新依赖）

### 状态判定（“待应用” dirty）

最小可行实现思路（两种可选，后续写 Implementation Plan 时再定）：

- **S1（推荐）**：维护 `pendingMpvCliReload: boolean`（存到 settings store 或本地 state）
  - 当触发字段变化时置为 true
  - 当用户点击 Reload 后置为 false（或在收到 `renderer-player-restart-complete` 时置为 false 更可靠）
- **S2**：维护“最后一次已应用的 CLI 配置快照”并做 diff
  - `appliedMpvCliConfigHash`
  - 变更后 hash 不一致则提示
  - Reload 完成后更新 applied hash

### 事件与生效点

- 仍沿用现有 `MPV_RELOAD` -> `mpvPlayer.restart()` -> `renderer-player-restart-complete` -> 重新 setQueue 的链路
- 结合既有修复：Reload 后应保持播放/暂停意图（已在引擎侧修复）

## 验收标准（Acceptance Criteria）

1. 当后端为 `DirectSound` 或 `WaveOut` 或 `auto` 时，UI **不显示** “独占模式/独占缓冲区”相关设置。
2. 当后端切换为 `WASAPI` 时，UI 显示独占相关设置，且之前保存的值会正确反映在 UI 上。
3. 修改 `audioOutputBackend` 或 `audioExclusiveMode`（或独占 buffer）后：
   - UI 出现提示条：“需要重载 MPV 才生效” + “重载 MPV”按钮
   - 点击“重载 MPV”后提示条消失
4. Reload 前如果播放器处于暂停状态，Reload 后 **不自动播放**；如果 Reload 前在播放，Reload 后继续播放（保持用户意图）。

## 最小验证步骤（人工）

- Windows 环境 + PlayerType=MPV（LOCAL）
- 选择 `audioOutputBackend=DirectSound`：确认独占相关项不出现
- 切换到 `WASAPI`：确认独占项出现
- 切换独占开关：提示条出现；点击“重载 MPV”；提示条消失
- 在暂停状态下点击 Reload：确认不自动播放；手动点播放才开始

