import isElectron from 'is-electron';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getMpvSetting } from './mpv-properties';

import { eventEmitter } from '/@/renderer/events/event-emitter';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    SettingOption,
    SettingsSection,
} from '/@/renderer/features/settings/components/settings-section';
import {
    SettingsState,
    usePlaybackSettings,
    useSettingsStoreActions,
} from '/@/renderer/store/settings.store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';
import { NumberInput } from '/@/shared/components/number-input/number-input';
import { Select } from '/@/shared/components/select/select';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { PlayerType } from '/@/shared/types/types';

const localSettings = isElectron() ? window.api.localSettings : null;
const mpvPlayer = isElectron() ? window.api.mpvPlayer : null;

export const MpvSettings = memo(() => {
    const { t } = useTranslation();
    const settings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();

    const [mpvPath, setMpvPath] = useState('');

    const handleSetMpvPath = async (clear?: boolean) => {
        if (clear) {
            localSettings?.set('mpv_path', undefined);
            setMpvPath('');
            return;
        }

        const result = await localSettings?.openFileSelector();

        if (result === null) {
            localSettings?.set('mpv_path', undefined);
            setMpvPath('');
            return;
        }

        localSettings?.set('mpv_path', result);
        setMpvPath(result);
    };

    useEffect(() => {
        const getMpvPath = async () => {
            if (!localSettings) return setMpvPath('');
            const mpvPath = (await localSettings.get('mpv_path')) as string | undefined;
            return setMpvPath(mpvPath || '');
        };

        getMpvPath();
    }, []);

    const handleSetMpvProperty = (
        setting: keyof SettingsState['playback']['mpvProperties'],
        value: any,
    ) => {
        console.log(`[SETTINGS] MPV property changed: ${setting} = ${JSON.stringify(value)}`);
        setSettings({
            playback: {
                mpvProperties: {
                    [setting]: value,
                },
            },
        });

        const mpvSetting = getMpvSetting(setting, value);
        console.log(`[SETTINGS] Sending to MPV runtime: ${JSON.stringify(mpvSetting)}`);
        if (mpvSetting && Object.keys(mpvSetting).length > 0) {
            mpvPlayer?.setProperties(mpvSetting);
        }
    };

    const player = usePlayer();

    const handleReloadMpv = () => {
        // 使用 reset: false 避免触发 seekToTimestamp(0)，
        // 因为 seek 命令会与 MPV restart 竞争导致 "IPC command invalid" 错误
        console.log('[SETTINGS] User clicked MPV reload button');
        player.mediaStop({ reset: false });
        eventEmitter.emit('MPV_RELOAD', {});
    };

    // MPV 可执行路径设置
    const options: SettingOption[] = [
        {
            control: (
                <Group gap="sm">
                    <ActionIcon
                        icon="refresh"
                        onClick={handleReloadMpv}
                        tooltip={{
                            label: t('common.reload', { postProcess: 'titleCase' }),
                            openDelay: 0,
                        }}
                        variant="subtle"
                    />
                    <TextInput
                        onChange={(e) => {
                            setMpvPath(e.currentTarget.value);
                            localSettings?.set('mpv_path', e.currentTarget.value.replace(/\\/g, '/'));
                        }}
                        onClick={() => handleSetMpvPath()}
                        placeholder={t('setting.mpvExecutablePath', {
                            context: 'placeholder',
                            postProcess: 'sentenceCase',
                        })}
                        rightSection={
                            mpvPath ? (
                                <ActionIcon
                                    icon="x"
                                    onClick={() => handleSetMpvPath(true)}
                                    variant="transparent"
                                />
                            ) : undefined
                        }
                        value={mpvPath}
                        width={200}
                    />
                </Group>
            ),
            description: t('setting.mpvExecutablePath', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden: settings.type !== PlayerType.LOCAL,
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.mpvExecutablePath', { postProcess: 'sentenceCase' }),
        },
    ];

    const generalOptions: SettingOption[] = [
        // 音频输出后端（CLI 专用，需重启 MPV）
        {
            control: (
                <Select
                    data={[
                        { label: t('common.auto', { postProcess: 'titleCase' }), value: 'auto' },
                        { label: 'WASAPI', value: 'wasapi' },
                        { label: 'DirectSound', value: 'dsound' },
                        { label: 'WaveOut', value: 'waveout' },
                    ]}
                    defaultValue={settings.mpvProperties.audioOutputBackend || 'auto'}
                    onChange={(e) => handleSetMpvProperty('audioOutputBackend', e)}
                />
            ),
            description: t('setting.audioOutputBackend', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden: settings.type !== PlayerType.LOCAL,
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.audioOutputBackend', { postProcess: 'sentenceCase' }),
        },
        // WASAPI 独占模式
        {
            control: (
                <Switch
                    defaultChecked={settings.mpvProperties.audioExclusiveMode === 'yes'}
                    onChange={(e) =>
                        handleSetMpvProperty(
                            'audioExclusiveMode',
                            e.currentTarget.checked ? 'yes' : 'no',
                        )
                    }
                />
            ),
            description: t('setting.audioExclusiveMode', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden: settings.type !== PlayerType.LOCAL,
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.audioExclusiveMode', { postProcess: 'sentenceCase' }),
        },
        // WASAPI 独占模式缓冲区
        {
            control: (
                <Select
                    data={[
                        {
                            label: t('setting.wasapiExclusiveBuffer', { context: 'optionDefault' }),
                            value: 'default',
                        },
                        {
                            label: t('setting.wasapiExclusiveBuffer', { context: 'optionMinimum' }),
                            value: 'min',
                        },
                        {
                            label: t('setting.wasapiExclusiveBuffer', { context: 'optionCustom' }),
                            value: 'custom',
                        },
                    ]}
                    defaultValue={settings.mpvProperties.wasapiExclusiveBuffer || 'default'}
                    onChange={(e) => handleSetMpvProperty('wasapiExclusiveBuffer', e)}
                />
            ),
            description: t('setting.wasapiExclusiveBuffer', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden:
                settings.type !== PlayerType.LOCAL ||
                settings.mpvProperties.audioExclusiveMode !== 'yes',
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.wasapiExclusiveBuffer', { postProcess: 'sentenceCase' }),
        },
        // WASAPI 独占模式自定义缓冲区（微秒）
        {
            control: (
                <NumberInput
                    defaultValue={settings.mpvProperties.wasapiExclusiveBufferUs || undefined}
                    max={2000000}
                    min={1000}
                    onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        handleSetMpvProperty(
                            'wasapiExclusiveBufferUs',
                            value >= 1000 ? value : undefined,
                        );
                    }}
                    placeholder="10000"
                    rightSection={<Text size="xs">us</Text>}
                    width={100}
                />
            ),
            description: t('setting.wasapiExclusiveBufferUs', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden:
                settings.type !== PlayerType.LOCAL ||
                settings.mpvProperties.audioExclusiveMode !== 'yes' ||
                settings.mpvProperties.wasapiExclusiveBuffer !== 'custom',
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.wasapiExclusiveBufferUs', { postProcess: 'sentenceCase' }),
        },
        // 无缝播放
        {
            control: (
                <Select
                    data={[
                        { label: t('common.no', { postProcess: 'titleCase' }), value: 'no' },
                        { label: t('common.yes', { postProcess: 'titleCase' }), value: 'yes' },
                        {
                            label: t('setting.gaplessAudio', {
                                context: 'optionWeak',
                                postProcess: 'sentenceCase',
                            }),
                            value: 'weak',
                        },
                    ]}
                    defaultValue={settings.mpvProperties.gaplessAudio}
                    onChange={(e) => handleSetMpvProperty('gaplessAudio', e)}
                />
            ),
            description: t('setting.gaplessAudio', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden: settings.type !== PlayerType.LOCAL,
            title: t('setting.gaplessAudio', { postProcess: 'sentenceCase' }),
        },
        // 采样率
        {
            control: (
                <NumberInput
                    defaultValue={settings.mpvProperties.audioSampleRateHz || undefined}
                    max={192000}
                    min={0}
                    onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        handleSetMpvProperty('audioSampleRateHz', value >= 8000 ? value : value);
                    }}
                    placeholder="48000"
                    rightSection={<Text size="xs">Hz</Text>}
                    width={100}
                />
            ),
            description: t('setting.sampleRate', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            note: t('setting.sampleRate', {
                context: 'note',
                postProcess: 'sentenceCase',
            }),
            title: t('setting.sampleRate', { postProcess: 'sentenceCase' }),
        },
        // 高品质重采样（CLI 专用，需重启 MPV）
        {
            control: (
                <Switch
                    defaultChecked={settings.mpvProperties.audioResampleHq}
                    onChange={(e) =>
                        handleSetMpvProperty('audioResampleHq', e.currentTarget.checked)
                    }
                />
            ),
            description: t('setting.audioResampleHq', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden: settings.type !== PlayerType.LOCAL,
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.audioResampleHq', { postProcess: 'sentenceCase' }),
        },
        // 音频缓冲区
        {
            control: (
                <NumberInput
                    defaultValue={settings.mpvProperties.audioBufferMs || undefined}
                    max={500}
                    min={10}
                    onBlur={(e) => {
                        const value = Number(e.currentTarget.value);
                        handleSetMpvProperty('audioBufferMs', value >= 10 ? value : undefined);
                    }}
                    placeholder="50"
                    rightSection={<Text size="xs">ms</Text>}
                    width={100}
                />
            ),
            description: t('setting.audioBufferMs', {
                context: 'description',
                postProcess: 'sentenceCase',
            }),
            isHidden: settings.type !== PlayerType.LOCAL,
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.audioBufferMs', { postProcess: 'sentenceCase' }),
        },
    ];

    const replayGainOptions: SettingOption[] = [
        {
            control: (
                <Select
                    data={[
                        {
                            label: t('setting.replayGainMode', {
                                context: 'optionNone',
                                postProcess: 'titleCase',
                            }),
                            value: 'no',
                        },
                        {
                            label: t('setting.replayGainMode', {
                                context: 'optionTrack',
                                postProcess: 'titleCase',
                            }),
                            value: 'track',
                        },
                        {
                            label: t('setting.replayGainMode', {
                                context: 'optionAlbum',
                                postProcess: 'titleCase',
                            }),
                            value: 'album',
                        },
                    ]}
                    defaultValue={settings.mpvProperties.replayGainMode}
                    onChange={(e) => handleSetMpvProperty('replayGainMode', e)}
                />
            ),
            description: t('setting.replayGainMode', {
                context: 'description',
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
            note: t('common.restartRequired', { postProcess: 'sentenceCase' }),
            title: t('setting.replayGainMode', {
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
        },
        {
            control: (
                <NumberInput
                    defaultValue={settings.mpvProperties.replayGainPreampDB}
                    onChange={(e) => handleSetMpvProperty('replayGainPreampDB', Number(e) || 0)}
                    width={75}
                />
            ),
            description: t('setting.replayGainMode', {
                context: 'description',
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
            title: t('setting.replayGainPreamp', {
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
        },
        {
            control: (
                <Switch
                    defaultChecked={settings.mpvProperties.replayGainClip}
                    onChange={(e) =>
                        handleSetMpvProperty('replayGainClip', e.currentTarget.checked)
                    }
                />
            ),
            description: t('setting.replayGainClipping', {
                context: 'description',
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
            title: t('setting.replayGainClipping', {
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
        },
        {
            control: (
                <NumberInput
                    defaultValue={settings.mpvProperties.replayGainFallbackDB}
                    onBlur={(e) =>
                        handleSetMpvProperty('replayGainFallbackDB', Number(e.currentTarget.value))
                    }
                    width={75}
                />
            ),
            description: t('setting.replayGainFallback', {
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
            title: t('setting.replayGainFallback', {
                postProcess: 'sentenceCase',
                ReplayGain: 'ReplayGain',
            }),
        },
    ];

    return (
        <>
            <SettingsSection options={options} />
            <SettingsSection options={generalOptions} />
            <SettingsSection options={replayGainOptions} />
        </>
    );
});
