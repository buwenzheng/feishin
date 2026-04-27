import type { RefObject } from 'react';

import isElectron from 'is-electron';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';

import { eventEmitter } from '/@/renderer/events/event-emitter';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { getSongUrl } from '/@/renderer/features/player/audio-player/hooks/use-stream-url';
import { AudioPlayer, PlayerOnProgressProps } from '/@/renderer/features/player/audio-player/types';
import { useRadioStore } from '/@/renderer/features/radio/hooks/use-radio-player';
import {
    getMpvCliParameters,
    getMpvProperties,
} from '/@/renderer/features/settings/components/playback/mpv-properties';
import {
    usePlaybackSettings,
    usePlayerActions,
    usePlayerSong,
    usePlayerStore,
    useSettingsStore,
} from '/@/renderer/store';
import { PlayerStatus } from '/@/shared/types/types';

export interface MpvPlayerEngineHandle extends AudioPlayer {}

interface MpvPlayerEngineProps {
    isMuted: boolean;
    isTransitioning: boolean;
    onEnded: () => void;
    onProgress: (e: PlayerOnProgressProps) => void;
    playerRef: RefObject<MpvPlayerEngineHandle | null>;
    playerStatus: PlayerStatus;
    speed?: number;
    volume: number;
}

const mpvPlayer = isElectron() ? window.api.mpvPlayer : null;
const mpvPlayerListener = isElectron() ? window.api.mpvPlayerListener : null;
const ipc = isElectron() ? window.api.ipc : null;

const PROGRESS_UPDATE_INTERVAL = 250;

/**
 * 校验 audio-device 与 AO 后端是否匹配
 * 当 --ao=wasapi 时，audio-device 必须是 "auto" 或 "wasapi/..." 格式
 * 不匹配的设备会导致 MPV 音频输出初始化失败，播放立即 stopped
 */
const validateAudioDevice = (audioDevice: string, aoBackend?: string): string => {
    if (!audioDevice || audioDevice === 'auto') return 'auto';
    if (!aoBackend || aoBackend === 'auto') return audioDevice;

    // audio-device 格式为 "backend/..." 或纯名称（如 "openal"）
    const slashIndex = audioDevice.indexOf('/');
    const deviceBackend = slashIndex > -1 ? audioDevice.substring(0, slashIndex) : audioDevice;

    // 如果设备后端与 AO 后端匹配，直接使用
    if (deviceBackend === aoBackend) return audioDevice;

    // 不匹配：降级为 auto 并打印警告
    console.warn(
        `[MPV-ENGINE] Audio device "${audioDevice}" (backend=${deviceBackend}) does not match AO backend "${aoBackend}", falling back to "auto"`,
    );
    return 'auto';
};

export const MpvPlayerEngine = (props: MpvPlayerEngineProps) => {
    const {
        isMuted,
        isTransitioning,
        onEnded,
        onProgress,
        playerRef,
        playerStatus,
        speed,
        volume,
    } = props;

    const [internalVolume, setInternalVolume] = useState(volume / 100 || 0);
    const currentSong = usePlayerSong();

    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isInitializedRef = useRef<boolean>(false);
    const hasPopulatedQueueRef = useRef<boolean>(false);
    const isMountedRef = useRef<boolean>(true);

    const { mpvAudioDeviceId, transcode } = usePlaybackSettings();
    const mpvProperties = useSettingsStore((store) => store.playback.mpvProperties);

    useEffect(() => {
        const handleMpvReload = async () => {
            // 直接通过 IPC 重启 MPV，而非依赖 useEffect 重新运行
            // useEffect 的 isRunning 检查会跳过重启，只更新属性
            const mpvCliParams = getMpvCliParameters(mpvProperties);
            const rawAudioDevice = mpvAudioDeviceId?.trim() || 'auto';
            const audioDevice = validateAudioDevice(
                rawAudioDevice,
                mpvProperties.audioOutputBackend,
            );
            const extraParameters = [...mpvCliParams, `--audio-device=${audioDevice}`];
            const properties = { ...getMpvProperties(mpvProperties), speed, volume };
            console.log(
                `[MPV-ENGINE] MPV_RELOAD: extraParameters=${JSON.stringify(extraParameters)}, properties=${JSON.stringify(properties)}`,
            );
            await mpvPlayer?.restart({ extraParameters, properties });
        };

        eventEmitter.on('MPV_RELOAD', handleMpvReload);

        return () => {
            eventEmitter.off('MPV_RELOAD', handleMpvReload);
        };
    }, [mpvProperties, mpvAudioDeviceId, speed, volume]);

    // 监听 MPV 重启完成事件，重新加载播放队列
    useEffect(() => {
        if (!mpvPlayerListener) {
            return;
        }

        const handleRestartComplete = () => {
            // 重启后 MPV 处于 idle 模式，需要重新加载当前歌曲
            console.log('[MPV-ENGINE] Restart complete, reloading queue...');
            // Preserve the user's play/pause intent across reload.
            // If we always set pause=false here, a reload from paused state will auto-play.
            const shouldPause = usePlayerStore.getState().player.status !== PlayerStatus.PLAYING;
            replaceMpvQueue(transcode, shouldPause);
        };

        mpvPlayerListener.rendererRestartComplete(handleRestartComplete);

        return () => {
            ipc?.removeAllListeners('renderer-player-restart-complete');
        };
    }, [transcode]);

    // Start the mpv instance on startup
    useEffect(() => {
        isMountedRef.current = true;

        const initializeMpv = async () => {
            // Always quit mpv first to ensure clean state, especially during HMR remounts
            const isRunning: boolean | undefined = await mpvPlayer?.isRunning();

            if (isRunning) {
                // MPV 已经在运行，只需重新设置属性，不需要重启
                isInitializedRef.current = true;
                hasPopulatedQueueRef.current = false;

                // 更新属性
                const properties: Record<string, any> = {
                    ...getMpvProperties(mpvProperties),
                    speed: speed,
                    volume: volume,
                };
                console.log(
                    `[MPV-ENGINE] Already running, updating properties: ${JSON.stringify(properties)}`,
                );
                mpvPlayer?.setProperties(properties);
                return;
            }

            // Reset initialization state
            isInitializedRef.current = false;
            hasPopulatedQueueRef.current = false;

            // Initialize mpv with fresh state
            const properties: Record<string, any> = {
                ...getMpvProperties(mpvProperties),
                speed: speed,
                volume: volume,
            };

            // 构建 extraParameters：用户自定义 + WASAPI CLI 参数 + 音频设备
            const extraParameters: string[] = [...getMpvCliParameters(mpvProperties)];

            const rawAudioDevice = mpvAudioDeviceId?.trim() || 'auto';
            const audioDevice = validateAudioDevice(
                rawAudioDevice,
                mpvProperties.audioOutputBackend,
            );
            extraParameters.push(`--audio-device=${audioDevice}`);

            console.log(
                `[MPV-ENGINE] Initializing MPV with extraParameters=${JSON.stringify(extraParameters)}, properties=${JSON.stringify(properties)}`,
            );

            await mpvPlayer?.initialize({
                extraParameters,
                properties,
            });

            // 初始化后填充播放队列
            const radioState = useRadioStore.getState();

            if (!radioState.currentStreamUrl) {
                const playerData = usePlayerStore.getState().getPlayerData();
                const currentSongUrl = playerData.currentSong
                    ? await getSongUrl(playerData.currentSong, transcode, true)
                    : undefined;
                const nextSongUrl = playerData.nextSong
                    ? await getSongUrl(playerData.nextSong, transcode, true)
                    : undefined;

                // Populate at least the current song on startup.
                // Previously we required both current + next to exist, which can leave MPV idle while the UI
                // already emits play/seek (e.g. restoring state). That manifests as "first song can't play
                // until next is pressed".
                if (currentSongUrl && !hasPopulatedQueueRef.current && mpvPlayer) {
                    console.log(
                        `[MPV-ENGINE] Populating queue: current=${currentSongUrl?.substring(0, 80)}..., next=${nextSongUrl?.substring(0, 80) ?? 'none'}...`,
                    );
                    mpvPlayer.setQueue(currentSongUrl, nextSongUrl, true);
                    hasPopulatedQueueRef.current = true;
                }
            }

            isInitializedRef.current = true;
        };

        initializeMpv();

        return () => {
            isMountedRef.current = false;
            // 不在 unmount 时 quit MPV —— HMR remount 会先 unmount 再 mount，
            // 如果 quit 会杀掉正在运行的 MPV 实例，导致播放中断。
            // isRunning 检查确保 remount 时发现已有实例不会重新初始化。
            isInitializedRef.current = false;
            hasPopulatedQueueRef.current = false;
        };
        // Note: volume, speed, and transcode are intentionally not in dependencies.
        // Volume and speed changes are handled by separate useEffects below to avoid
        // reinitializing the entire player. Transcode changes are handled by queue
        // update callbacks in usePlayerEvents.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mpvProperties, mpvAudioDeviceId]);

    // Update volume
    useEffect(() => {
        if (!mpvPlayer) {
            return;
        }

        const vol = volume / 100 || 0;
        queueMicrotask(() => {
            setInternalVolume(vol);
        });
        mpvPlayer.volume(volume);
    }, [volume]);

    // Update mute status
    useEffect(() => {
        if (!mpvPlayer) {
            return;
        }

        mpvPlayer.mute(isMuted);
    }, [isMuted]);

    // Update speed/playback rate
    useEffect(() => {
        if (!mpvPlayer) {
            return;
        }

        if (!speed) {
            return;
        }

        mpvPlayer.setProperties({ speed });
    }, [speed]);

    // Handle play/pause status
    useEffect(() => {
        if (!mpvPlayer) {
            return;
        }

        if (playerStatus === PlayerStatus.PLAYING) {
            mpvPlayer.play();
        } else if (playerStatus === PlayerStatus.PAUSED) {
            mpvPlayer.pause();
        }
    }, [playerStatus]);

    const hasCurrentSong = !!currentSong?.id;

    // Set up progress tracking
    useEffect(() => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
        }

        if (!hasCurrentSong) {
            return;
        }

        if (playerStatus !== PlayerStatus.PLAYING) {
            return;
        }

        const updateProgress = async () => {
            if (!mpvPlayer || !isMountedRef.current) {
                return;
            }

            try {
                const time = await mpvPlayer.getCurrentTime();
                if (time !== undefined && isMountedRef.current) {
                    onProgress({
                        played: time / (time + 10),
                        playedSeconds: time,
                    });
                }
            } catch {
                // Handle error silently
            }
        };

        const interval = PROGRESS_UPDATE_INTERVAL;
        progressIntervalRef.current = setInterval(updateProgress, interval);
        updateProgress();

        return () => {
            isMountedRef.current = false;
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        };
    }, [hasCurrentSong, isTransitioning, onProgress, playerStatus]);

    const { mediaAutoNext } = usePlayerActions();

    useEffect(() => {
        if (!mpvPlayerListener) {
            return;
        }

        const handleOnAutoNext = () => {
            mediaAutoNext();
            handleMpvAutoNext(transcode);
        };

        mpvPlayerListener.rendererAutoNext(handleOnAutoNext);

        return () => {
            ipc?.removeAllListeners('renderer-player-auto-next');
        };
    }, [mediaAutoNext, onEnded, transcode]);

    usePlayerEvents(
        {
            onMediaNext: () => {
                replaceMpvQueue(transcode);
            },
            onMediaPrev: () => {
                replaceMpvQueue(transcode);
            },
            onNextSongInsertion: async (song) => {
                const radioState = useRadioStore.getState();

                if (radioState.currentStreamUrl) {
                    return;
                }

                const nextSongUrl = song ? await getSongUrl(song, transcode, true) : undefined;
                mpvPlayer?.setQueueNext(nextSongUrl);
            },
            onPlayerPlay: () => {
                replaceMpvQueue(transcode);
            },
            onQueueCleared: () => {},
            onQueueRestored: () => {
                replaceMpvQueue(transcode);
            },
        },
        [transcode],
    );

    useImperativeHandle<MpvPlayerEngineHandle, MpvPlayerEngineHandle>(playerRef, () => ({
        decreaseVolume(by: number) {
            const newVol = Math.max(0, internalVolume - by / 100);
            setInternalVolume(newVol);
            if (mpvPlayer) {
                mpvPlayer.volume(newVol * 100);
            }
        },
        increaseVolume(by: number) {
            const newVol = Math.min(1, internalVolume + by / 100);
            setInternalVolume(newVol);
            if (mpvPlayer) {
                mpvPlayer.volume(newVol * 100);
            }
        },
        pause() {
            if (mpvPlayer) {
                mpvPlayer.pause();
            }
        },
        play() {
            if (mpvPlayer) {
                mpvPlayer.play();
            }
        },
        seekTo(seekTo: number) {
            if (mpvPlayer) {
                mpvPlayer.seekTo(seekTo);
            }
        },
        setVolume(vol: number) {
            const volDecimal = vol / 100 || 0;
            setInternalVolume(volDecimal);
            if (mpvPlayer) {
                mpvPlayer.volume(vol);
            }
        },
    }));

    return <div id="mpv-player-engine" style={{ display: 'none' }} />;
};

MpvPlayerEngine.displayName = 'MpvPlayerEngine';

async function handleMpvAutoNext(transcode: {
    bitrate?: number | undefined;
    enabled: boolean;
    format?: string | undefined;
}) {
    const playerData = usePlayerStore.getState().getPlayerData();
    const nextSongUrl = playerData.nextSong
        ? await getSongUrl(playerData.nextSong, transcode, true)
        : undefined;
    mpvPlayer?.autoNext(nextSongUrl);
}

async function replaceMpvQueue(
    transcode: {
        bitrate?: number | undefined;
        enabled: boolean;
        format?: string | undefined;
    },
    pause?: boolean,
) {
    // Don't override queue if radio is active
    const radioState = useRadioStore.getState();

    if (radioState.currentStreamUrl) {
        return;
    }

    const playerData = usePlayerStore.getState().getPlayerData();
    const currentSongUrl = playerData.currentSong
        ? await getSongUrl(playerData.currentSong, transcode, true)
        : undefined;
    const nextSongUrl = playerData.nextSong
        ? await getSongUrl(playerData.nextSong, transcode, true)
        : undefined;
    mpvPlayer?.setQueue(currentSongUrl, nextSongUrl, pause);
}
