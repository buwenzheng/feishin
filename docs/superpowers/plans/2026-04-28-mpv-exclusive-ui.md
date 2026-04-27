# MPV WASAPI Exclusive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 上让“独占模式”仅在 WASAPI 后端下可见，并在修改后端/独占相关设置后提示“需重载 MPV 才生效”，提供一键重载按钮。

**Architecture:** 将 mpv 的“CLI 专用设置”(ao/exclusive/buffer) 与运行时可应用设置区分开；UI 通过可见性规则避免误导，通过“待应用提示条”提示用户点击 Reload 触发现有 `MPV_RELOAD` 重启链路。

**Tech Stack:** React + Zustand（settings store）+ i18next + Electron IPC（MPV_RELOAD 事件链路）

---

## File Structure（将要修改/新增的文件）

- Modify: `src/renderer/features/settings/components/playback/mpv-settings.tsx`
  - 仅在 `audioOutputBackend === 'wasapi'` 时显示独占相关项
  - 增加“需重载 MPV 生效”的提示条（含一键 reload）
  - 维护 `requiresMpvReload`（dirty）状态
- Modify: `src/i18n/locales/en.json`
  - 新增提示条文案 key（建议放在 `setting.*`）
- Modify: `src/i18n/locales/zh-Hans.json`
  - 同上

（可选，若需要更可靠地清理 dirty 状态）
- Modify: `src/renderer/features/player/audio-player/engine/mpv-player-engine.tsx`
  - 在 `renderer-player-restart-complete` 收到后触发一个 event（例如 `MPV_RELOAD_APPLIED`）供 settings UI 清理 dirty
  - *本计划先不做该可选项，最小实现只在点击 Reload 时清理 dirty*

---

### Task 1: 限定“独占模式”仅在 WASAPI 后端显示

**Files:**
- Modify: `src/renderer/features/settings/components/playback/mpv-settings.tsx`

- [ ] **Step 1: 在 `MpvSettings` 内计算 `isWasapiBackend`**

在组件 render 逻辑中新增：

```ts
const isWasapiBackend = settings.mpvProperties.audioOutputBackend === 'wasapi';
```

- [ ] **Step 2: 调整独占相关 SettingOption 的 `isHidden` 规则**

把以下项的 `isHidden` 增加 `!isWasapiBackend`：

- `audioExclusiveMode`
- `wasapiExclusiveBuffer`
- `wasapiExclusiveBufferUs`

示例（以 `audioExclusiveMode` 为例）：

```ts
isHidden: settings.type !== PlayerType.LOCAL || !isWasapiBackend,
```

对 `wasapiExclusiveBuffer` / `wasapiExclusiveBufferUs` 也要同时保留原本的依赖条件（例如 `audioExclusiveMode !== 'yes'`）。

- [ ] **Step 3: 手动验证可见性**

手动步骤：

- 后端选 `auto` / `dsound` / `waveout`：确认“音频独占模式”不出现
- 后端选 `wasapi`：确认出现

---

### Task 2: “变更需重载 MPV 才生效”的提示条 + 一键 Reload

**Files:**
- Modify: `src/renderer/features/settings/components/playback/mpv-settings.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-Hans.json`

- [ ] **Step 1: 增加本地 dirty 状态**

在 `MpvSettings` 组件顶部 state 区域新增：

```ts
const [requiresMpvReload, setRequiresMpvReload] = useState(false);
```

- [ ] **Step 2: 定义哪些设置属于“CLI 专用，需要 Reload”**

在组件内新增一个集合：

```ts
const CLI_KEYS_REQUIRING_RELOAD = new Set<
  keyof SettingsState['playback']['mpvProperties']
>([
  'audioOutputBackend',
  'audioExclusiveMode',
  'wasapiExclusiveBuffer',
  'wasapiExclusiveBufferUs',
]);
```

- [ ] **Step 3: 在 `handleSetMpvProperty` 中设置 dirty**

在 `handleSetMpvProperty(setting, value)` 末尾追加：

```ts
if (CLI_KEYS_REQUIRING_RELOAD.has(setting)) {
  setRequiresMpvReload(true);
}
```

注意：此处不需要 diff（最小实现），只要发生改动就提示。

- [ ] **Step 4: 在 `handleReloadMpv` 中清理 dirty**

在现有 `handleReloadMpv()` 末尾追加：

```ts
setRequiresMpvReload(false);
```

（最小实现假设用户点击 reload 即已开始应用；若后续要更严谨，可在收到 restart-complete 时再清理。）

- [ ] **Step 5: 在 UI 中插入提示条（含按钮）**

在 `generalOptions` 渲染区域上方插入一个条件块（结构跟项目现有组件风格一致：`Group` + `Text` + `ActionIcon`）。

建议结构（伪代码）：

```tsx
{requiresMpvReload ? (
  <Group justify="space-between" align="center">
    <Text>
      {t('setting.mpvReloadRequired', { postProcess: 'sentenceCase' })}
    </Text>
    <ActionIcon icon="refresh" onClick={handleReloadMpv} />
  </Group>
) : null}
```

样式不做复杂设计（KISS）：只要清晰、可点击。

- [ ] **Step 6: 补齐 i18n 文案**

新增 key：

- `setting.mpvReloadRequired`

在 `en.json`：

```json
"mpvReloadRequired": "audio backend / exclusive changes require reloading MPV to take effect"
```

在 `zh-Hans.json`：

```json
"mpvReloadRequired": "音频后端/独占设置修改后需要重载 MPV 才会生效"
```

放置位置：`setting` 节点下，和 `audioExclusiveMode_description` 等并列。

- [ ] **Step 7: 手动验证提示条行为**

验证点：

- 修改 `audioOutputBackend`：提示条出现；点击“Reload”后提示条消失
- 修改 `audioExclusiveMode`（在 WASAPI 下）：同上
- 修改 buffer 设置：同上

---

### Task 3: 端到端手动回归（独占链路 + 不误导）

**Files:**
- 无（仅手动验证）

- [ ] **Step 1: 非 WASAPI 下无独占 UI**

后端切到 `DirectSound` / `WaveOut`：

- 预期：独占相关项不可见
- 预期：不会生成 `--audio-exclusive=...`（已由 `getMpvCliParameters` 保证）

- [ ] **Step 2: WASAPI 下独占 UI 生效**

后端切到 `WASAPI`：

- 预期：独占项可见
- 开/关独占 -> 提示条出现 -> 点击 Reload
- 预期：Reload 后播放链路仍稳定（不会出现 mpv.start timeout / stopped 竞态）

---

## Self-Review（本计划自检）

- Spec 覆盖：已包含“仅 WASAPI 显示独占”与“变更需重载提示条 + 一键 reload”两条已确认决策
- 占位符扫描：无 TBD/TODO；每步都有明确代码/手动验证步骤
- 字段一致性：`audioOutputBackend` / `audioExclusiveMode` / `wasapiExclusiveBuffer` / `wasapiExclusiveBufferUs` 与现有 `mpv-settings.tsx` 一致

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-mpv-exclusive-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

