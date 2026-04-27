import type { SettingsState } from '/@/renderer/store/settings.store';

/**
 * 将 UI 设置映射为 MPV 运行时属性（通过 setProperty/setMultipleProperties 设置）
 * 注意：仅包含可运行时修改的属性；CLI 专用参数（如 --ao=wasapi）在 mpv-player-engine.tsx 中处理
 */
export const getMpvSetting = (
    key: keyof SettingsState['playback']['mpvProperties'],
    value: any,
) => {
    switch (key) {
        case 'audioBufferMs':
            return { 'audio-buffer': value };
        case 'audioChannels':
            return { 'audio-channels': value };
        case 'audioDither':
            return { 'audio-dither': value };
        case 'audioExclusiveMode':
            // audio-exclusive 切换会导致 MPV 重新初始化音频输出，
            // 可能中断播放并使 MPV 进入异常状态（IPC command invalid）
            // 应作为 CLI 专用参数，需重启 MPV 生效
            return {};
        case 'audioFormat':
            return { 'audio-format': value };
        case 'audioResampleHq':
            // 运行时切换重采样质量需要重启音频输出，暂不支持运行时修改
            return {};
        case 'audioSampleRateHz':
            return { 'audio-samplerate': value };
        case 'gaplessAudio':
            return { 'gapless-audio': value || 'weak' };
        case 'replayGainClip':
            return { 'replaygain-clip': value || 'no' };
        case 'replayGainFallbackDB':
            return { 'replaygain-fallback': value };
        case 'replayGainMode':
            return { replaygain: value || 'no' };
        case 'replayGainPreampDB':
            return { 'replaygain-preamp': value || 0 };
        // audioOutputBackend / wasapiExclusiveBuffer / wasapiExclusiveBufferUs
        // 这些是 CLI 专用参数，不通过属性设置
        default:
            return {};
    }
};

/**
 * 构建 MPV 初始化时的属性集合
 * 排除 undefined 值以避免覆盖 mpv 默认值
 */
export const getMpvProperties = (settings: SettingsState['playback']['mpvProperties']) => {
    const properties: Record<string, any> = {
        'audio-samplerate':
            settings.audioSampleRateHz === 0 ? undefined : settings.audioSampleRateHz,
        'gapless-audio': settings.gaplessAudio || 'weak',
        replaygain: settings.replayGainMode || 'no',
        'replaygain-clip': settings.replayGainClip || 'no',
        'replaygain-fallback': settings.replayGainFallbackDB,
        'replaygain-preamp': settings.replayGainPreampDB || 0,
    };

    // 仅当用户明确设置时覆盖 mpv 默认值
    if (settings.audioBufferMs !== undefined) {
        properties['audio-buffer'] = settings.audioBufferMs;
    }
    if (settings.audioChannels) {
        properties['audio-channels'] = settings.audioChannels;
    }
    if (settings.audioDither) {
        properties['audio-dither'] = settings.audioDither;
    }

    // 清除 undefined 值
    Object.keys(properties).forEach((key) =>
        properties[key] === undefined ? delete properties[key] : {},
    );

    return properties;
};

/**
 * 构建 WASAPI 相关的 CLI 参数（用于 mpv 启动时的 extraParameters）
 * 这些参数必须在 mpv 启动时通过 CLI 传入，运行时无法修改
 */
export const getMpvCliParameters = (
    settings: SettingsState['playback']['mpvProperties'],
): string[] => {
    const params: string[] = [];

    // 音频输出后端选择
    if (settings.audioOutputBackend && settings.audioOutputBackend !== 'auto') {
        params.push(`--ao=${settings.audioOutputBackend}`);
    }

    // WASAPI 独占模式
    // 这里显式传递 yes/no，避免用户从 yes 切到 no 后重启仍残留旧行为（尤其是 Windows/WASAPI 场景）
    if (settings.audioOutputBackend === 'wasapi' && settings.audioExclusiveMode) {
        params.push(`--audio-exclusive=${settings.audioExclusiveMode}`);
    }

    // WASAPI 独占模式缓冲区（仅当独占开启时有意义）
    if (settings.audioOutputBackend === 'wasapi' && settings.audioExclusiveMode === 'yes') {
        if (settings.wasapiExclusiveBuffer) {
            if (settings.wasapiExclusiveBuffer === 'min') {
                params.push('--wasapi-exclusive-buffer=min');
            } else if (
                settings.wasapiExclusiveBuffer === 'custom' &&
                settings.wasapiExclusiveBufferUs
            ) {
                params.push(`--wasapi-exclusive-buffer=${settings.wasapiExclusiveBufferUs}`);
            }
            // 'default' 不传递参数，使用 mpv 默认值
        }
    }

    // 重采样质量：
    // 之前的低延迟参数 `--audio-swresample-o=filter_size=16:cutoff=0.8` 在 mpv 0.41 + FFmpeg swresample
    // 上会触发解析错误并导致音频初始化失败（随后立即 stopped）。
    // 先临时禁用该参数，使用 mpv 默认行为，保证播放稳定；后续再补一个经过验证的低延迟参数方案。

    console.log(`[MPV-PROPS] getMpvCliParameters: settings=${JSON.stringify({
        audioExclusiveMode: settings.audioExclusiveMode,
        audioOutputBackend: settings.audioOutputBackend,
        audioResampleHq: settings.audioResampleHq,
        wasapiExclusiveBuffer: settings.wasapiExclusiveBuffer,
        wasapiExclusiveBufferUs: settings.wasapiExclusiveBufferUs,
    })}, result=${JSON.stringify(params)}`);

    return params;
};
