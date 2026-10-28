import { useState, useSyncExternalStore } from 'react';
import { Volume2, VolumeX, X, Music2, Square } from 'lucide-react';
import { audioEngine } from './AudioEngine';
import {
    channelNames,
    effectNames,
    intensityNames,
    mediaApi,
    type Channel,
    type Effect,
    type Intensity,
} from './model';
import { AssetLibrary } from '../workspace/assets/AssetLibrary';
import { Dialog } from '../workspace/Dialog';
import { commandId } from '../api/workspace';
import type { LibraryAsset } from '../api/preparation';

export function MediaPanel({
    campaignId,
    gm = false,
    syncError = '',
}: {
    campaignId: string;
    gm?: boolean;
    syncError?: string;
}) {
    const view = useSyncExternalStore(audioEngine.subscribe, audioEngine.getSnapshot);
    const [open, setOpen] = useState(false),
        [picker, setPicker] = useState<Channel | null>(null);
    const [fade, setFade] = useState(1000),
        [volume, setVolume] = useState(0.8),
        [loop, setLoop] = useState(true);
    const [error, setError] = useState(''),
        [busy, setBusy] = useState(false);
    const [retry, setRetry] = useState<{ action: string; data: object; id: string } | null>(null);
    const state = view.state;
    const send = async (
        action: string,
        config: object,
        previous?: { data: object; id: string },
    ) => {
        const data = previous?.data ?? { ...config, sceneId: state?.sceneId, epoch: state?.epoch };
        const id = previous?.id ?? commandId();
        setBusy(true);
        setError('');
        setRetry(null);
        try {
            const result = await mediaApi.command(campaignId, action, data, id);
            if ('revision' in result) audioEngine.hydrate(result);
        } catch (e) {
            setError((e as Error).message);
            setRetry({ action, data, id });
        } finally {
            setBusy(false);
        }
    };
    const useAsset = (asset: LibraryAsset) => {
        audioEngine.stopPreview();
        setPicker(null);
        void send(asset.kind === 'sfx' ? 'sfx.play' : `${asset.kind}.start`, {
            assetId: asset.id,
            volume,
            fade,
            loop: asset.kind === 'ambient' || loop,
        });
    };
    return (
        <div className="media-control">
            <button
                className={`media-toggle ${!view.enabled ? 'muted' : ''}`}
                title={view.enabled ? 'Звук и атмосфера' : 'Звук выключен в этом браузере'}
                onClick={() => setOpen(!open)}
            >
                {view.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                <span>Звук</span>
                {!view.enabled && <i />}
            </button>
            {!view.enabled && (
                <button className="audio-unlock" onClick={() => void audioEngine.unlock()}>
                    Включить звук
                </button>
            )}
            {open && (
                <section className="audio-panel panel" aria-label="Звук и атмосфера">
                    <header>
                        <div>
                            <span className="eyebrow">{gm ? 'ПУЛЬТ АТМОСФЕРЫ' : 'МОЙ ЗВУК'}</span>
                            <h3>Звук</h3>
                        </div>
                        <button aria-label="Закрыть звук" onClick={() => setOpen(false)}>
                            <X size={17} />
                        </button>
                    </header>
                    {!view.enabled && (
                        <p className="hint">
                            Браузер ждёт вашего разрешения. Пропущенные звуки не будут повторяться.
                        </p>
                    )}
                    {(view.error || syncError) && (
                        <p className="form-error" role="status">
                            {view.error || syncError}
                            <button onClick={() => void audioEngine.unlock()}>Включить звук</button>
                        </p>
                    )}
                    <details className="audio-local" open={!gm}>
                        <summary>Моя громкость</summary>
                        {(['master', 'music', 'ambient', 'sfx'] as const).map((key) => (
                            <label key={key} className="audio-slider">
                                <span>
                                    {key === 'master' ? 'Общая громкость' : channelNames[key]}
                                </span>
                                <input
                                    aria-label={`Моя громкость · ${key === 'master' ? 'Общая' : channelNames[key]}`}
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={view.preferences[key]}
                                    onChange={(e) => audioEngine.preference(key, +e.target.value)}
                                />
                                <output>{Math.round(view.preferences[key] * 100)}%</output>
                            </label>
                        ))}
                    </details>
                    {state && (
                        <>
                            <div className="audio-now">
                                <Music2 size={17} />
                                <div>
                                    <small>Сейчас играет</small>
                                    <strong>{state.music?.name ?? 'Тишина'}</strong>
                                    {state.music?.paused && <small>На паузе</small>}
                                </div>
                            </div>
                            {gm && (
                                <fieldset disabled={busy || !!retry}>
                                    {state.music && (
                                        <div className="audio-row">
                                            <button
                                                onClick={() =>
                                                    void send(
                                                        state.music?.paused
                                                            ? 'music.resume'
                                                            : 'music.pause',
                                                        {},
                                                    )
                                                }
                                            >
                                                {state.music.paused ? 'Продолжить' : 'Пауза'}
                                            </button>
                                            <button
                                                onClick={() => void send('music.stop', { fade })}
                                            >
                                                Остановить музыку
                                            </button>
                                        </div>
                                    )}
                                    <div className="audio-row">
                                        {(['music', 'ambient', 'sfx'] as const).map((kind) => (
                                            <button
                                                key={kind}
                                                disabled={kind !== 'music' && !state.sceneId}
                                                onClick={() => setPicker(kind)}
                                            >
                                                {kind === 'sfx'
                                                    ? '▶ Звук'
                                                    : `+ ${channelNames[kind]}`}
                                            </button>
                                        ))}
                                    </div>
                                    {state.ambient.map((track) => (
                                        <div className="audio-track" key={track.id}>
                                            <span>{track.name}</span>
                                            <button
                                                title={`Остановить ${track.name}`}
                                                onClick={() =>
                                                    void send('ambient.stop', {
                                                        assetId: track.assetId,
                                                        fade,
                                                    })
                                                }
                                            >
                                                <Square size={13} />
                                            </button>
                                        </div>
                                    ))}
                                    <div className="audio-row">
                                        <label>
                                            Переход
                                            <select
                                                value={fade}
                                                onChange={(e) => setFade(+e.target.value)}
                                            >
                                                {[0, 500, 1000, 2000, 5000].map((ms) => (
                                                    <option key={ms} value={ms}>
                                                        {ms / 1000} сек
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label>
                                            Дорожка
                                            <select
                                                value={volume}
                                                onChange={(e) => setVolume(+e.target.value)}
                                            >
                                                {[0.2, 0.4, 0.6, 0.8, 1].map((n) => (
                                                    <option key={n} value={n}>
                                                        {n * 100}%
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={loop}
                                                onChange={(e) => setLoop(e.target.checked)}
                                            />
                                            Повтор музыки
                                        </label>
                                    </div>
                                    <h4>Громкость для стола</h4>
                                    {(['music', 'ambient', 'sfx'] as const).map((channel) => (
                                        <label className="audio-slider" key={channel}>
                                            <span>{channelNames[channel]}</span>
                                            <input
                                                aria-label={`Громкость стола · ${channelNames[channel]}`}
                                                key={state.volumes[channel]}
                                                type="range"
                                                min="0"
                                                max="1"
                                                step="0.05"
                                                defaultValue={state.volumes[channel]}
                                                onPointerUp={(e) =>
                                                    void send('audio.volume', {
                                                        channel,
                                                        volume: +e.currentTarget.value,
                                                    })
                                                }
                                                onKeyUp={(e) => {
                                                    if (
                                                        [
                                                            'ArrowLeft',
                                                            'ArrowRight',
                                                            'Home',
                                                            'End',
                                                        ].includes(e.key)
                                                    )
                                                        void send('audio.volume', {
                                                            channel,
                                                            volume: +e.currentTarget.value,
                                                        });
                                                }}
                                            />
                                            <output>
                                                {Math.round(state.volumes[channel] * 100)}%
                                            </output>
                                        </label>
                                    ))}
                                    <h4>Атмосфера активной сцены</h4>
                                    {!state.sceneId && (
                                        <p className="hint">
                                            Активируйте сцену, чтобы включить атмосферу.
                                        </p>
                                    )}
                                    {(Object.keys(effectNames) as Effect[]).map((effect) => (
                                        <label className="atmosphere-control" key={effect}>
                                            <input
                                                type="checkbox"
                                                checked={!!state.effects[effect]}
                                                disabled={!state.sceneId}
                                                onChange={(e) =>
                                                    void send(
                                                        e.target.checked
                                                            ? 'atmosphere.start'
                                                            : 'atmosphere.stop',
                                                        { effect, intensity: 'medium' },
                                                    )
                                                }
                                            />
                                            <span>{effectNames[effect]}</span>
                                            <select
                                                aria-label={`Интенсивность · ${effectNames[effect]}`}
                                                disabled={!state.effects[effect]}
                                                value={state.effects[effect] ?? 'medium'}
                                                onChange={(e) =>
                                                    void send('atmosphere.start', {
                                                        effect,
                                                        intensity: e.target.value,
                                                    })
                                                }
                                            >
                                                {(Object.keys(intensityNames) as Intensity[]).map(
                                                    (key) => (
                                                        <option key={key} value={key}>
                                                            {intensityNames[key]}
                                                        </option>
                                                    ),
                                                )}
                                            </select>
                                        </label>
                                    ))}
                                    <p className="hint">
                                        Музыка продолжается между сценами. Атмосфера и её звуки
                                        выключаются при переходе.
                                    </p>
                                </fieldset>
                            )}
                        </>
                    )}
                    {error && (
                        <p className="form-error" role="alert">
                            {error}
                        </p>
                    )}
                    {retry && (
                        <div className="audio-row">
                            <button
                                disabled={busy}
                                onClick={() => void send(retry.action, {}, retry)}
                            >
                                Повторить команду
                            </button>
                            <button
                                onClick={() => {
                                    setRetry(null);
                                    setError('');
                                }}
                            >
                                Закрыть ошибку
                            </button>
                        </div>
                    )}
                </section>
            )}
            {picker && (
                <Dialog
                    title={`Выбрать · ${channelNames[picker]}`}
                    onClose={() => {
                        audioEngine.stopPreview();
                        setPicker(null);
                    }}
                >
                    <AssetLibrary campaignId={campaignId} pickerKind={picker} onUse={useAsset} />
                </Dialog>
            )}
        </div>
    );
}
