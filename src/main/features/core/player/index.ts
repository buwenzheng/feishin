import console from 'console';
import { app, ipcMain } from 'electron';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import uniq from 'lodash/uniq';
import MpvAPI from 'node-mpv';
import { pid } from 'node:process';
import path from 'path';
import process from 'process';

import { getMainWindow, sendToastToRenderer } from '../../../index';
import { createLog, isWindows } from '../../../utils';
import { store } from '../settings';

import { PlayerData } from '/@/shared/types/domain-types';

declare module 'node-mpv';

let mpvInstance: MpvAPI | null = null;
let mpvInitializing: boolean = false;
let currentPlayerData: null | PlayerData = null;
let currentSocketPath = isWindows()
    ? `\\\\.\\pipe\\mpvserver-${pid}`
    : `/tmp/node-mpv-${pid}.sock`;
let lastRestartAtMs = 0;
let lastMpvLogPath: null | string = null;

const waitForMpvRunning = async (instance: MpvAPI, timeoutMs: number) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            if (instance.isRunning()) {
                return true;
            }
        } catch {
            // ignore
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
};

const NodeMpvErrorCode = {
    0: 'Unable to load file or stream',
    1: 'Invalid argument',
    2: 'Binary not found',
    3: 'IPC command invalid',
    4: 'Unable to bind IPC socket',
    5: 'Connection timeout',
    6: 'MPV is already running',
    7: 'Could not send IPC message',
    8: 'MPV is not running',
    9: 'Unsupported protocol',
};

type NodeMpvError = {
    errcode: number;
    errmessage?: string;
    method: string;
    stackTrace: string;
    verbose: string;
};

const mpvLog = (
    data: { action: string; toast?: 'info' | 'success' | 'warning' },
    err?: NodeMpvError,
) => {
    const { action, toast } = data;

    if (err) {
        const detail = err.errmessage ? ` (reason: ${err.errmessage})` : '';
        const message = `[AUDIO PLAYER] ${action} - mpv errorcode ${err.errcode} - ${
            NodeMpvErrorCode[err.errcode as keyof typeof NodeMpvErrorCode]
        }${detail}`;

        sendToastToRenderer({ message, type: 'error' });
        createLog({ message, type: 'error' });
        return;
    }

    const message = `[AUDIO PLAYER] ${action}`;
    createLog({ message, type: 'info' });
    if (toast) {
        sendToastToRenderer({ message, type: toast });
    }
};

/**
 * MPV 二进制文件路径查找优先级：
 * 1. 用户手动指定的路径（mpv_path setting）
 * 2. 应用资源目录（production: process.resourcesPath/mpv/；dev: resources/mpv/）
 * 3. undefined — 由 node-mpv 自行在 PATH 中查找
 */
const getMpvBinaryPath = (): string | undefined => {
    // 1. 用户手动指定路径
    const userPath = store.get('mpv_path') as string | undefined;
    createLog({
        message: `[AUDIO PLAYER] getMpvBinaryPath: userPath=${userPath}, getAppPath=${app.getAppPath()}, resourcesPath=${process.resourcesPath}`,
        type: 'info',
    });
    if (userPath && existsSync(userPath)) {
        createLog({ message: `[AUDIO PLAYER] Using user-specified mpv at: ${userPath}`, type: 'info' });
        return userPath;
    }

    // 2. 生产打包模式：extraResources 展开到 process.resourcesPath/mpv/
    if (process.resourcesPath) {
        const bundledPath = path.join(process.resourcesPath, 'mpv', 'mpv.exe');
        if (existsSync(bundledPath)) {
            createLog({ message: `[AUDIO PLAYER] Using bundled mpv at: ${bundledPath}`, type: 'info' });
            return bundledPath;
        }
    }

    // 3. 开发模式：项目根目录 resources/mpv/
    const devPath = path.join(app.getAppPath(), 'resources', 'mpv', 'mpv.exe');
    if (existsSync(devPath)) {
        createLog({ message: `[AUDIO PLAYER] Using dev mode mpv at: ${devPath}`, type: 'info' });
        return devPath;
    }

    // 4. 回退：由 node-mpv 自行在 PATH 中查找
    createLog({ message: '[AUDIO PLAYER] No mpv found in bundled or dev paths, falling back to PATH lookup', type: 'warning' });
    return undefined;
};

const prefetchPlaylistParams = [
    '--prefetch-playlist=no',
    '--prefetch-playlist=yes',
    '--prefetch-playlist',
];

const hasCliFlag = (extraParameters: string[] | undefined, flag: string) => {
    if (!extraParameters) return false;
    return extraParameters.some((p) => p === flag || p.startsWith(`${flag}=`));
};

/**
 * 构建 MPV 默认 CLI 参数
 * 包含 bit-perfect 音频输出所需的安全默认值
 */
const DEFAULT_MPV_PARAMETERS = (extraParameters?: string[]) => {
    const parameters = [
        '--idle=yes',
        '--no-config',
        '--load-scripts=no',
        '--audio-file-auto=no',
        '--audio-normalize-downmix=no',
        '--audio-stream-silence=yes',
    ];

    if (!extraParameters?.some((param) => prefetchPlaylistParams.includes(param))) {
        parameters.push('--prefetch-playlist=yes');
    }

    return parameters;
};

const createMpv = async (data: {
    binaryPath?: string;
    extraParameters?: string[];
    properties?: Record<string, any>;
}): Promise<MpvAPI> => {
    const { binaryPath, extraParameters, properties } = data;

    const params = uniq([...DEFAULT_MPV_PARAMETERS(extraParameters), ...(extraParameters || [])]);

    // Use a unique IPC socket/pipe per instance to avoid Windows named pipe reuse races during restart.
    // Reusing the same pipe name can cause mpv.start() to hang if the old process hasn't released it yet.
    currentSocketPath = isWindows()
        ? `\\\\.\\pipe\\mpvserver-${pid}-${Date.now()}`
        : `/tmp/node-mpv-${pid}-${Date.now()}.sock`;

    const resolvedBinary = binaryPath || getMpvBinaryPath() || undefined;
    console.log(`[MAIN-MPV] createMpv: resolvedBinary=${resolvedBinary ?? 'undefined (PATH lookup)'}`);
    console.log(`[MAIN-MPV] createMpv: params=${JSON.stringify(params)}`);
    console.log(`[MAIN-MPV] createMpv: properties=${JSON.stringify(properties)}`);
    console.log(`[MAIN-MPV] createMpv: socket=${currentSocketPath}`);
    createLog({
        message: `[AUDIO PLAYER] Resolved mpv binary: ${resolvedBinary ?? 'undefined (PATH lookup)'}`,
        type: 'info',
    });

    const mpv = new MpvAPI(
        {
            audio_only: true,
            auto_restart: false,
            binary: resolvedBinary,
            socket: currentSocketPath,
            time_update: 1,
        },
        params,
    );

    try {
        // 给 mpv.start() 加超时保护，防止进程崩溃时 Promise 永不 resolve
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const startPromise = mpv.start();
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('mpv.start() timed out after 15s')), 15000);
        });
        await Promise.race([startPromise, timeoutPromise]);
        // mpv.start() 成功，清除超时定时器防止幽灵 reject
        if (timeoutId) clearTimeout(timeoutId);
        createLog({ message: '[AUDIO PLAYER] mpv started successfully', type: 'info' });
    } catch (error: any) {
        createLog({
            message: `[AUDIO PLAYER] mpv failed to start: ${error?.message ?? error}`,
            type: 'error',
        });
        console.error('mpv failed to start', error);
        // mpv 启动失败时必须抛出，让调用者知道实例不可用
        throw error;
    } finally {
        // 即使 start 失败也尝试设置属性（某些属性可能在 restart 场景下仍有效）
        try {
            await mpv.setMultipleProperties(properties || {});
        } catch {
            // 属性设置失败不影响主流程
        }
    }

    mpv.on('status', (status) => {
        console.log(`[MAIN-MPV] event: status property=${status.property}, value=${status.value}`);
        if (status.property === 'playlist-pos') {
            if (status.value === -1) {
                mpv?.pause();
                return;
            }

            if (typeof status.value === 'number' && status.value > 0) {
                getMainWindow()?.webContents.send('renderer-player-auto-next');
            }
        }
    });

    mpv.on('resumed', () => {
        console.log('[MAIN-MPV] event: resumed (playing)');
        getMainWindow()?.webContents.send('renderer-player-play');
    });

    mpv.on('stopped', () => {
        // NOTE: MPV may emit a "stopped" event during restart/idle transitions.
        // Broadcasting that to the renderer can cause the playback state machine to fight the
        // restart flow (stop/pause/seek/play churn) and lead to immediate playback failure.
        // We gate stop broadcasting on MPV state.
        console.log('[MAIN-MPV] event: stopped');

        const instance = getMpvInstance();
        if (!instance) {
            return;
        }

        // Fire-and-forget async probe of MPV state.
        void (async () => {
            try {
                const [idleActive, playlistPos, playlistCount, pathProp, aoProp, audioDeviceProp] =
                    await Promise.all([
                        instance.getProperty('idle-active').catch(() => true),
                        instance.getProperty('playlist-pos').catch(() => -1),
                        instance.getProperty('playlist-count').catch(() => 0),
                        instance.getProperty('path').catch(() => null),
                        instance.getProperty('ao').catch(() => null),
                        instance.getProperty('audio-device').catch(() => null),
                    ]);

                console.log(
                    `[MAIN-MPV] stopped probe: idle=${idleActive}, playlist-pos=${playlistPos}, playlist-count=${playlistCount}, path=${pathProp}, ao=${aoProp}, audio-device=${audioDeviceProp}, sinceRestartMs=${Date.now() - lastRestartAtMs}`,
                );

                // If MPV is idle / no active playlist item, treat this as a transition stop and do not
                // propagate it to the renderer.
                if (idleActive || playlistCount === 0 || playlistPos === -1 || !pathProp) {
                    return;
                }

                getMainWindow()?.webContents.send('renderer-player-stop');
            } catch (e) {
                // If probe fails, fall back to existing behavior.
                getMainWindow()?.webContents.send('renderer-player-stop');
            }
        })();
    });

    mpv.on('paused', () => {
        console.log('[MAIN-MPV] event: paused');
        getMainWindow()?.webContents.send('renderer-player-pause');
    });

    mpv.on('seek', () => {
        console.log('[MAIN-MPV] event: seek');
    });

    mpv.on('quit', () => {
        console.log('[MAIN-MPV] event: quit');
    });

    mpv.on('timeposition', (time: number) => {
        getMainWindow()?.webContents.send('renderer-player-current-time', time);
    });

    return mpv;
};

export const getMpvInstance = () => {
    return mpvInstance;
};

const quit = async (instance?: MpvAPI | null) => {
    const mpv = instance || getMpvInstance();
    if (mpv) {
        try {
            await mpv.quit();
        } catch {
            const mpvProcess = (mpv as any).process || (mpv as any).mpvProcess;
            if (mpvProcess && typeof mpvProcess.kill === 'function') {
                try {
                    mpvProcess.kill('SIGTERM');
                } catch (killErr) {
                    mpvLog({ action: 'Failed to kill mpv process' }, killErr as NodeMpvError);
                }
            }
        }
        if (!isWindows()) {
            try {
                await rm(currentSocketPath);
            } catch {
                // Ignore errors when removing socket file
            }
        }
    }
};

const setAudioPlayerFallback = (isError: boolean) => {
    getMainWindow()?.webContents.send('renderer-player-fallback', isError);
};

ipcMain.on('player-set-properties', async (_event, data: Record<string, any>) => {
    console.log(`[MAIN-MPV] player-set-properties: ${JSON.stringify(data)}`);
    mpvLog({ action: `Setting properties: ${JSON.stringify(data)}` });
    const keys = Object.keys(data || {});
    if (keys.length === 0) {
        return;
    }

    try {
        if (keys.length === 1) {
            const key = keys[0];
            getMpvInstance()?.setProperty(key, data[key]);
        } else {
            getMpvInstance()?.setMultipleProperties(data);
        }
    } catch (err: any | NodeMpvError) {
        console.log(`[MAIN-MPV] setProperties FAILED: ${JSON.stringify(data)}, error=${err?.message || err}`);
        mpvLog({ action: `Failed to set properties: ${JSON.stringify(data)}` }, err);
    }
});

ipcMain.handle(
    'player-restart',
    async (
        _event,
        data: {
            binaryPath?: string;
            extraParameters?: string[];
            properties?: Record<string, any>;
        },
    ) => {
        try {
            mpvLog({
                action: `Attempting to restart mpv with parameters: ${JSON.stringify(data)}`,
            });

            // 防止并发初始化
            if (mpvInitializing) {
                createLog({ message: '[AUDIO PLAYER] MPV initialization already in progress during restart, skipping', type: 'warning' });
                return;
            }
            mpvInitializing = true;

            // 清理旧实例：先 stop，再 quit，最后强制 kill 确保进程退出
            // Windows 命名管道在进程未完全退出时会阻止新实例绑定
            try {
                getMpvInstance()?.stop();
            } catch {
                // 忽略
            }

            // 尝试优雅退出
            const oldInstance = getMpvInstance();
            const oldProcess = oldInstance ? (oldInstance as any).process || (oldInstance as any).mpvProcess : null;
            try {
                await oldInstance?.quit();
            } catch {
                // 优雅退出失败，强制 kill
            }

            // 如果进程仍在运行，强制终止
            if (oldProcess && typeof oldProcess.kill === 'function') {
                try {
                    // 检查进程是否仍在运行
                    if (oldProcess.exitCode === null) {
                        oldProcess.kill('SIGKILL');
                        createLog({ message: '[AUDIO PLAYER] Forcefully killed old mpv process', type: 'warning' });
                    }
                } catch {
                    // 进程可能已经退出
                }
            }

            // 等待命名管道释放（Windows 需要）
            if (isWindows()) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
            mpvInstance = null;

            lastRestartAtMs = Date.now();
            mpvInstance = await createMpv(data);
            mpvLog({ action: 'Restarted mpv', toast: 'success' });
            setAudioPlayerFallback(false);
            // 重启后通知渲染进程重新加载播放队列
            // 新 MPV 实例处于 idle 模式，没有加载任何文件
            getMainWindow()?.webContents.send('renderer-player-restart-complete');
        } catch (err: any | NodeMpvError) {
            mpvLog({ action: 'Failed to restart mpv, falling back to web player' }, err);
            setAudioPlayerFallback(true);
        } finally {
            mpvInitializing = false;
        }
    },
);

ipcMain.handle(
    'player-initialize',
    async (
        _event,
        data: {
            extraParameters?: string[];
            properties?: Record<string, any>;
        },
    ) => {
        try {
            // 防止并发初始化（HMR remount 可能同时触发两次）
            if (mpvInitializing) {
                createLog({ message: '[AUDIO PLAYER] MPV initialization already in progress, skipping', type: 'warning' });
                return;
            }

            // 如果 MPV 已在运行，跳过初始化，只更新属性
            if (mpvInstance && mpvInstance.isRunning()) {
                createLog({ message: '[AUDIO PLAYER] MPV already running, updating properties only', type: 'info' });
                if (data.properties) {
                    await mpvInstance.setMultipleProperties(data.properties);
                }
                return;
            }

            mpvInitializing = true;
            mpvLog({
                action: `Attempting to initialize mpv with parameters: ${JSON.stringify(data)}`,
            });
            mpvInstance = await createMpv(data);
            setAudioPlayerFallback(false);
        } catch (err: any | NodeMpvError) {
            mpvLog({ action: 'Failed to initialize mpv, falling back to web player' }, err);
            setAudioPlayerFallback(true);
        } finally {
            mpvInitializing = false;
        }
    },
);

ipcMain.on('player-quit', async () => {
    try {
        await getMpvInstance()?.stop();
        await quit();
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: 'Failed to quit mpv' }, err);
    } finally {
        mpvInstance = null;
    }
});

ipcMain.handle('player-is-running', async () => {
    return getMpvInstance()?.isRunning();
});

ipcMain.handle('player-clean-up', async () => {
    getMpvInstance()?.stop();
    getMpvInstance()?.clearPlaylist();
});

ipcMain.on('player-start', async () => {
    try {
        await getMpvInstance()?.play();
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: 'Failed to start mpv playback' }, err);
    }
});

ipcMain.on('player-play', async () => {
    console.log('[MAIN-MPV] player-play received');
    try {
        await getMpvInstance()?.play();
        console.log('[MAIN-MPV] player-play completed');
    } catch (err: any | NodeMpvError) {
        console.log(`[MAIN-MPV] player-play FAILED: ${err?.message || err}`);
        mpvLog({ action: 'Failed to start mpv playback' }, err);
    }
});

ipcMain.on('player-pause', async () => {
    console.log('[MAIN-MPV] player-pause received');
    try {
        await getMpvInstance()?.pause();
    } catch (err: any | NodeMpvError) {
        console.log(`[MAIN-MPV] player-pause FAILED: ${err?.message || err}`);
        mpvLog({ action: 'Failed to pause mpv playback' }, err);
    }
});

ipcMain.on('player-stop', async () => {
    console.log('[MAIN-MPV] player-stop received');
    try {
        await getMpvInstance()?.stop();
    } catch (err: any | NodeMpvError) {
        console.log(`[MAIN-MPV] player-stop FAILED: ${err?.message || err}`);
        mpvLog({ action: 'Failed to stop mpv playback' }, err);
    }
});

ipcMain.on('player-next', async () => {
    try {
        await getMpvInstance()?.next();
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: 'Failed to go to next track' }, err);
    }
});

ipcMain.on('player-previous', async () => {
    try {
        await getMpvInstance()?.prev();
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: 'Failed to go to previous track' }, err);
    }
});

ipcMain.on('player-seek', async (_event, time: number) => {
    try {
        const mpv = getMpvInstance();
        if (!mpv || !mpv.isRunning()) return;
        await mpv.seek(time);
    } catch (err: any | NodeMpvError) {
        // 空闲状态下的 seek 失败（error code 3/8）是正常竞态，不报错
        if (err?.errcode === 3 || err?.errcode === 8) {
            createLog({ message: `[AUDIO PLAYER] Seek skipped - MPV not ready`, type: 'info' });
            return;
        }
        mpvLog({ action: `Failed to seek by ${time} seconds` }, err);
    }
});

ipcMain.on('player-seek-to', async (_event, time: number) => {
    try {
        const mpv = getMpvInstance();
        if (!mpv || !mpv.isRunning()) return;
        // 检查 MPV 是否处于 idle 状态（无文件加载），空闲时 seek 无意义
        const idle = await mpv.getProperty('idle-active').catch(() => true);
        if (idle) {
            createLog({ message: `[AUDIO PLAYER] Seek to ${time}s skipped - MPV idle (no file loaded)`, type: 'info' });
            return;
        }
        await mpv.goToPosition(time);
    } catch (err: any | NodeMpvError) {
        // 空闲状态下的 seek 失败是正常竞态，不报错
        if (err?.errcode === 3 || err?.errcode === 8) {
            createLog({ message: `[AUDIO PLAYER] Seek to ${time}s skipped - MPV not ready`, type: 'info' });
            return;
        }
        mpvLog({ action: `Failed to seek to ${time} seconds` }, err);
    }
});

ipcMain.on('player-set-queue', async (_event, current?: string, next?: string, pause?: boolean) => {
    createLog({ message: `[AUDIO PLAYER] setQueue: current=${current ? current.substring(0, 80) : 'none'}, next=${next ? next.substring(0, 80) : 'none'}, pause=${pause}`, type: 'info' });
    if (!current && !next) {
        try {
            await getMpvInstance()?.clearPlaylist();
            await getMpvInstance()?.pause();
            return;
        } catch (err: any | NodeMpvError) {
            mpvLog({ action: `Failed to clear play queue` }, err);
        }
    }

    try {
        if (current) {
            try {
                await getMpvInstance()?.load(current, 'replace');
                createLog({ message: '[AUDIO PLAYER] setQueue: current song loaded successfully', type: 'info' });
                // 检查加载后 MPV 状态
                const idleActive = await getMpvInstance()?.getProperty('idle-active');
                const pauseState = await getMpvInstance()?.getProperty('pause');
                const mediaTitle = await getMpvInstance()?.getProperty('media-title');
                console.log(`[MAIN-MPV] post-load status: idle=${idleActive}, pause=${pauseState}, title=${mediaTitle}`);
            } catch (error: any | NodeMpvError) {
                console.log(`[MAIN-MPV] load failed: ${error?.message || error}`);
                mpvLog({ action: `Failed to load current song` }, error);
                await getMpvInstance()?.play();
            }

            if (next) {
                await getMpvInstance()?.load(next, 'append');
            }
        }

        if (pause) {
            await getMpvInstance()?.pause();
        } else if (pause === false) {
            createLog({ message: '[AUDIO PLAYER] setQueue: calling play() to start playback', type: 'info' });
            await getMpvInstance()?.play();
            createLog({ message: '[AUDIO PLAYER] setQueue: play() returned', type: 'info' });
        }
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: `Failed to set play queue` }, err);
    }
});

ipcMain.on('player-set-queue-next', async (_event, url?: string) => {
    try {
        const size = await getMpvInstance()?.getPlaylistSize();

        if (size && size > 1) {
            await getMpvInstance()?.playlistRemove(1);
        }

        if (url) {
            getMpvInstance()?.load(url, 'append');
        }
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: `Failed to set play queue` }, err);
    }
});

ipcMain.on('player-auto-next', async (_event, url?: string) => {
    try {
        await getMpvInstance()
            ?.playlistRemove(0)
            .catch(() => {
                getMpvInstance()?.pause();
            });

        if (url) {
            await getMpvInstance()?.load(url, 'append');
        }
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: `Failed to load next song` }, err);
    }
});

ipcMain.on('player-volume', async (_event, value: number) => {
    try {
        if (!value || value < 0 || value > 100) {
            return;
        }

        await getMpvInstance()?.volume(value);
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: `Failed to set volume to ${value}` }, err);
    }
});

ipcMain.on('player-mute', async (_event, mute: boolean) => {
    try {
        await getMpvInstance()?.mute(mute);
    } catch (err: any | NodeMpvError) {
        mpvLog({ action: `Failed to set mute status` }, err);
    }
});

ipcMain.handle('player-get-time', async (): Promise<number | undefined> => {
    try {
        const mpv = getMpvInstance();
        if (!mpv) {
            return undefined;
        }
        return await mpv.getTimePosition();
    } catch (err: any | NodeMpvError) {
        if (err?.errcode === 3) {
            return undefined;
        }
        mpvLog({ action: `Failed to get current time` }, err);
        return undefined;
    }
});

ipcMain.on('player-update-metadata', (_event, data: PlayerData) => {
    currentPlayerData = data;
});

ipcMain.handle('player-metadata', async (): Promise<null | PlayerData> => {
    return currentPlayerData;
});

ipcMain.handle(
    'player-stream-metadata',
    async (): Promise<null | { artist: null | string; title: null | string }> => {
        try {
            const metadata = await getMpvInstance()?.getProperty('metadata');
            if (metadata && typeof metadata === 'object') {
                let artist: null | string =
                    (metadata['artist'] as string) ||
                    (metadata['ARTIST'] as string) ||
                    (metadata['icy-artist'] as string) ||
                    null;
                let title: null | string =
                    (metadata['title'] as string) || (metadata['TITLE'] as string) || null;

                if (!title && !artist) {
                    const combinedTitle =
                        (metadata['icy-title'] as string) ||
                        (metadata['StreamTitle'] as string) ||
                        (metadata['stream-title'] as string) ||
                        null;

                    if (combinedTitle && typeof combinedTitle === 'string') {
                        const match = combinedTitle.match(/^(.*?)\s*[-–—]\s*(.+)$/);
                        if (match) {
                            artist = match[1].trim() || null;
                            title = match[2].trim() || null;
                        } else {
                            title = combinedTitle;
                        }
                    }
                } else if (!title) {
                    const combinedTitle =
                        (metadata['icy-title'] as string) ||
                        (metadata['StreamTitle'] as string) ||
                        (metadata['stream-title'] as string) ||
                        null;
                    if (combinedTitle && typeof combinedTitle === 'string') {
                        title = combinedTitle;
                    }
                } else if (!artist) {
                    const combinedTitle =
                        (metadata['icy-title'] as string) ||
                        (metadata['StreamTitle'] as string) ||
                        (metadata['stream-title'] as string) ||
                        null;
                    if (
                        combinedTitle &&
                        typeof combinedTitle === 'string' &&
                        combinedTitle !== title
                    ) {
                        const match = combinedTitle.match(/^(.*?)\s*[-–—]\s*(.+)$/);
                        if (match && match[2].trim() === title) {
                            artist = match[1].trim() || null;
                        }
                    }
                }

                return { artist, title };
            }
            return null;
        } catch (err: any | NodeMpvError) {
            mpvLog({ action: `Failed to get stream metadata` }, err);
            return null;
        }
    },
);

/**
 * 获取音频设备列表
 * device.name 格式为 "wasapi/{GUID}"，可直接用于 --audio-device
 * UI 显示时优先使用 description（友好名称），label 中不再包含技术名称
 * aoBackend 参数用于过滤：只返回匹配当前 AO 后端的设备和 auto 设备
 */
ipcMain.handle(
    'player-get-audio-devices',
    async (_event, aoBackend?: string): Promise<{ backend: string; label: string; value: string }[]> => {
        try {
            const instance = getMpvInstance();
            let tempInstance: MpvAPI | null = null;
            let mpvToUse: MpvAPI | null = null;

            if (instance) {
                // If MPV is currently initializing, do NOT spawn a second MPV process just to query devices.
                // Doing so can interfere with node-mpv startup/IPC handshake and cause mpv.start() timeouts.
                if (mpvInitializing && !instance.isRunning()) {
                    await waitForMpvRunning(instance, 2000);
                }

                if (instance.isRunning()) {
                    mpvToUse = instance;
                }
            }

            if (!mpvToUse) {
                try {
                    tempInstance = await createMpv({});
                    mpvToUse = tempInstance;
                } catch (err: any | NodeMpvError) {
                    mpvLog(
                        { action: 'Failed to create temporary MPV instance for audio device list' },
                        err,
                    );
                    return [];
                }
            }

            try {
                const deviceList = await mpvToUse.getProperty('audio-device-list');

                if (!deviceList || !Array.isArray(deviceList)) {
                    return [];
                }

                const devices = deviceList.map((device: any) => {
                    const name: string = device.name || device.description || 'Unknown Device';
                    const description: string = device.description || '';

                    // 从 "wasapi/{GUID}" 格式中解析后端类型
                    const slashIndex = name.indexOf('/');
                    const backend = slashIndex > -1 ? name.substring(0, slashIndex) : '';
                    const friendlyName =
                        description || (slashIndex > -1 ? name.substring(slashIndex + 1) : name);

                    return {
                        backend,
                        label: friendlyName,
                        value: name,
                    };
                });

                // 如果指定了 AO 后端，只返回匹配该后端的设备和 auto 设备
                // 避免 --ao=wasapi 时出现 openal 等不兼容设备
                if (aoBackend && aoBackend !== 'auto') {
                    const filtered = devices.filter(
                        (d) => d.value === 'auto' || d.backend === aoBackend,
                    );
                    console.log(`[MAIN-MPV] Audio device filter: ao=${aoBackend}, total=${devices.length}, filtered=${filtered.length}`);
                    return filtered;
                }

                return devices;
            } finally {
                if (tempInstance && tempInstance !== instance) {
                    try {
                        await quit(tempInstance);
                    } catch {
                        // Ignore
                    }
                }
            }
        } catch (err: any | NodeMpvError) {
            mpvLog({ action: 'Failed to get audio devices' }, err);
            return [];
        }
    },
);

enum MpvState {
    STARTED,
    IN_PROGRESS,
    DONE,
}

let mpvState = MpvState.STARTED;

const cleanupMpv = async (force = false) => {
    if (mpvState === MpvState.DONE && !force) {
        return;
    }

    const instance = getMpvInstance();
    if (instance) {
        try {
            if (!force) {
                await instance.stop();
            }
            await quit(instance);
        } catch (err: any | NodeMpvError) {
            mpvLog({ action: `Failed to cleanup mpv` }, err);
            const mpvProcess = (instance as any).process || (instance as any).mpvProcess;
            if (mpvProcess && typeof mpvProcess.kill === 'function') {
                try {
                    mpvProcess.kill('SIGKILL');
                } catch {
                    // Ignore kill errors
                }
            }
        } finally {
            mpvInstance = null;
        }
    }
};

app.on('before-quit', async (event) => {
    switch (mpvState) {
        case MpvState.DONE:
            return;
        case MpvState.IN_PROGRESS:
            event.preventDefault();
            break;
        case MpvState.STARTED: {
            try {
                mpvState = MpvState.IN_PROGRESS;
                event.preventDefault();
                await cleanupMpv();
            } catch (err: any | NodeMpvError) {
                mpvLog({ action: `Failed to cleanly before-quit` }, err);
            } finally {
                mpvState = MpvState.DONE;
                app.quit();
            }
            break;
        }
    }
});

process.on('exit', () => {
    const instance = getMpvInstance();
    if (instance) {
        const mpvProcess = (instance as any).process || (instance as any).mpvProcess;
        if (mpvProcess && typeof mpvProcess.kill === 'function') {
            try {
                mpvProcess.kill('SIGKILL');
            } catch {
                // Ignore errors during exit
            }
        }
    }
});

process.on('SIGINT', async () => {
    await cleanupMpv(true);
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await cleanupMpv(true);
    process.exit(0);
});

process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await cleanupMpv(true).catch(() => {
        // Ignore cleanup errors during crash
    });
});

process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled rejection:', reason);
    await cleanupMpv(true).catch(() => {
        // Ignore cleanup errors
    });
});
