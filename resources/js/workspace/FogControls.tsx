import { useEffect, useState, useSyncExternalStore } from 'react';
import { Brush, CloudFog, SquareDashed, X } from 'lucide-react';
import { request } from '../api/client';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { Scene } from '../tabletop/types/scene';
import type { FogBase, FogStroke } from '../tabletop/types/spatial';
import type { SaveQueue } from '../tabletop/state/SaveQueue';
import { ConfirmDialog } from './ConfirmDialog';
import { HistoryControls } from './HistoryControls';

const operations = [
    ['cover', 'Скрыть', 'Наложить ручной туман поверх обзора'],
    ['reveal', 'Стереть', 'Вернуть область к автоматическому обзору и памяти'],
    ['explore', 'Раскрыть', 'Показать публичный фон как исследованный'],
] as const;

export function FogControls({
    store,
    active = true,
    onActivate,
}: {
    store: SceneStore;
    active?: boolean;
    onActivate?: () => void;
}) {
    const { operation, shape, radius } = useSyncExternalStore(
        store.spatial.subscribe,
        store.spatial.getSettings,
    );
    const update = (
        patch: Partial<Pick<FogStroke, 'operation' | 'shape'> & { radius: number }>,
    ) => {
        store.spatial.setSettings(patch);
        if (!active) onActivate?.();
    };
    return (
        <>
            <div className="fog-options" role="group" aria-label="Действие тумана">
                {operations.map(([value, label, title]) => (
                    <button
                        key={value}
                        aria-pressed={active && operation === value}
                        title={title}
                        onClick={() => update({ operation: value })}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div className="fog-options" role="group" aria-label="Форма тумана">
                <button
                    aria-pressed={active && shape === 'brush'}
                    aria-label="Кисть"
                    title="Кисть"
                    onClick={() => update({ shape: 'brush' })}
                >
                    <Brush size={16} />
                </button>
                <button
                    aria-pressed={active && shape === 'rectangle'}
                    aria-label="Прямоугольник"
                    title="Прямоугольник"
                    onClick={() => update({ shape: 'rectangle' })}
                >
                    <SquareDashed size={16} />
                </button>
            </div>
            {shape === 'brush' && (
                <label className="fog-radius">
                    <span>Диаметр</span>
                    <input
                        aria-label="Диаметр кисти"
                        type="range"
                        min="5"
                        max="600"
                        step="5"
                        value={radius}
                        onChange={(e) => update({ radius: +e.target.value })}
                    />
                    <output>{radius * 2} px</output>
                </label>
            )}
        </>
    );
}

type Preview = {
    revision: number;
    players: { id: string; name: string }[];
    player: string | null;
    vision: Scene['vision'] | null;
};

function FogPreview({ store, active }: { store: SceneStore; active: boolean }) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [enabled, setEnabled] = useState(false);
    const [player, setPlayer] = useState('');
    const [preview, setPreview] = useState<Preview>();
    const [error, setError] = useState('');
    useEffect(
        () => () => {
            store.spatial.fogVision = undefined;
        },
        [store, enabled, active, scene.id, scene.vision?.enabled, player],
    );
    useEffect(() => {
        if (!enabled || !active || !scene.id || !scene.vision?.enabled) return;
        const abort = new AbortController();
        const timer = window.setTimeout(() => {
            const suffix = player ? `?player=${encodeURIComponent(player)}` : '';
            void request<Preview>(
                `/scenes/${scene.id}/fog/preview${suffix}`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((result) => {
                    if (abort.signal.aborted) return;
                    if (result.revision !== scene.revision) {
                        store.onRevisionGap?.();
                        return;
                    }
                    setError('');
                    setPreview(result);
                    store.spatial.fogVision = result.vision ?? undefined;
                })
                .catch((error: Error) => {
                    if (!abort.signal.aborted) setError(error.message);
                });
        }, 160);
        return () => {
            window.clearTimeout(timer);
            abort.abort();
        };
    }, [store, enabled, active, scene.id, scene.revision, scene.vision?.enabled, player]);
    if (!scene.vision?.enabled) return <p>Автоматический обзор выключен.</p>;
    return (
        <>
            <label className="check-field">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                />
                Автообзор игрока
            </label>
            {enabled && preview?.players.length ? (
                <label>
                    <span>Игрок</span>
                    <select
                        aria-label="Игрок для автообзора"
                        value={player || preview.player || ''}
                        onChange={(event) => setPlayer(event.target.value)}
                    >
                        {preview.players.map(({ id, name }) => (
                            <option key={id} value={id}>
                                {name}
                            </option>
                        ))}
                    </select>
                </label>
            ) : null}
            {enabled && error && <p role="alert">{error}</p>}
            {enabled && preview && !preview.players.length && <p>В кампании пока нет игроков.</p>}
        </>
    );
}

export function FogPanel({
    store,
    queue,
    onClose,
    editor = false,
    active = true,
    showHistory = false,
}: {
    store: SceneStore;
    queue: SaveQueue;
    onClose: () => void;
    editor?: boolean;
    active?: boolean;
    showHistory?: boolean;
}) {
    const [reset, setReset] = useState<FogBase>();
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const notice = useSyncExternalStore(store.spatial.subscribe, store.spatial.getFogNotice);
    const panel = (
        <div className={editor ? 'map-editor-panel-body fog-panel-body' : 'fog-panel-body'}>
            {!editor && (
                <div className="fog-options">
                    <FogControls store={store} />
                </div>
            )}
            <p>
                Перетащите по карте. Esc отменяет жест. Нажмите ещё раз, чтобы вернуться к выбору.
            </p>
            {editor && (
                <>
                    <div className="fog-legend" aria-label="Обозначения тумана">
                        <span>
                            <i className="fog-legend-cover" /> Ручной туман
                        </span>
                        <span>
                            <i className="fog-legend-reveal" /> Раскрыто вручную
                        </span>
                        <span>
                            <i className="fog-legend-unknown" /> Неизвестно
                        </span>
                        <span>
                            <i className="fog-legend-memory" /> Исследовано
                        </span>
                        <span>
                            <i className="fog-legend-current" /> Видно сейчас
                        </span>
                    </div>
                    <FogPreview store={store} active={active} />
                    <p>
                        Раскрытие показывает фон. Токены и интерактивные объекты по-прежнему зависят
                        от обзора.
                    </p>
                </>
            )}
            <div className="fog-options">
                {showHistory && store.history && <HistoryControls store={store} />}
                <button disabled={save.status !== 'saved'} onClick={() => setReset('clear')}>
                    Сбросить ручной туман…
                </button>
                {editor && (
                    <button disabled={save.status !== 'saved'} onClick={() => setReset('covered')}>
                        Скрыть всю карту…
                    </button>
                )}
            </div>
            {!editor && save.status === 'saving' && <p role="status">Сохраняем сцену…</p>}
            {notice && <p role="alert">{notice}</p>}
        </div>
    );
    return (
        <>
            <section
                className={editor ? 'map-editor-panel fog-panel' : 'spatial-settings fog-panel'}
                aria-label="Ручной туман"
            >
                <div className={editor ? 'panel-heading' : 'fog-heading'}>
                    <CloudFog size={16} />
                    <strong>Ручной туман</strong>
                    <button
                        className="icon-button"
                        aria-label="Выйти из режима тумана"
                        onClick={onClose}
                    >
                        <X size={15} />
                    </button>
                </div>
                {panel}
            </section>
            {reset && (
                <ConfirmDialog
                    title={reset === 'clear' ? 'Сбросить ручной туман?' : 'Скрыть всю карту?'}
                    description={
                        reset === 'clear'
                            ? 'Вся карта вернётся к автоматическому обзору. Исследованная игроками территория сохранится.'
                            : 'Ручной туман закроет всю карту. Исследованная игроками территория сохранится.'
                    }
                    buttonLabel={reset === 'clear' ? 'Сбросить туман' : 'Скрыть карту'}
                    onClose={() => setReset(undefined)}
                    submit={async () => store.resetFog(reset)}
                />
            )}
        </>
    );
}
