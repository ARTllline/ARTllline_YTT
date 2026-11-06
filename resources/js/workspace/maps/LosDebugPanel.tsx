import { useEffect, useState, useSyncExternalStore } from 'react';
import { commandId, type Mutation } from '../../api/workspace';
import { request } from '../../api/client';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { Point } from '../../tabletop/types/scene';
import { probePoints, type LosDebug } from '../../tabletop/vision/model';
import { ConfirmDialog } from '../ConfirmDialog';

export function LosDebugPanel({ store, probing }: { store: SceneStore; probing: boolean }) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [observerId, setObserverId] = useState(scene.tokens[0]?.id ?? '');
    const [targetId, setTargetId] = useState('');
    const [range, setRange] = useState(scene.tokens[0]?.visionRange ?? 600);
    const [point, setPoint] = useState<Point>();
    const [result, setResult] = useState<LosDebug>();
    const [status, setStatus] = useState('');
    const [retry, setRetry] = useState(0);
    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const saveVision = async (
        enabled: boolean,
        memoryPolicy = scene.vision?.memoryPolicy ?? 'player',
    ) => {
        setSaving(true);
        try {
            const result = await request<Mutation>(`/scenes/${scene.id}/vision`, 'POST', {
                enabled,
                observerId,
                range,
                memoryPolicy,
                clientMutationId: commandId(),
            });
            store.accept(result, true);
            setStatus('Настройки обзора сохранены');
        } catch (error) {
            setStatus((error as Error).message);
        } finally {
            setSaving(false);
        }
    };
    const observer = scene.tokens.find((t) => t.id === observerId);
    useEffect(() => {
        if (!probing || store.role !== 'gm') return;
        store.bindLosProbe((p) => {
            setPoint({
                x: Math.max(0, Math.min(scene.width, p.x)),
                y: Math.max(0, Math.min(scene.height, p.y)),
            });
            setTargetId('');
        });
        return () => {
            store.bindLosProbe();
        };
    }, [store, probing, scene.width, scene.height]);
    useEffect(() => {
        if (store.role !== 'gm') return;
        store.setLosDebug();
        if (!observer || !scene.id) return;
        const abort = new AbortController();
        const revision = scene.revision ?? 0;
        // Debounce domain changes, never query from the Pixi render loop.
        const timer = window.setTimeout(() => {
            setStatus('Проверяем сохранённую геометрию…');
            const points = probePoints(observer, range, scene.width, scene.height);
            const targets = [
                ...points.map((point) => ({ point })),
                ...(targetId ? [{ tokenId: targetId }] : point ? [{ point }] : []),
            ];
            void request<LosDebug>(
                `/scenes/${scene.id}/los`,
                'POST',
                {
                    observer: { tokenId: observerId },
                    targets,
                    range,
                },
                abort.signal,
            )
                .then((data) => {
                    if (abort.signal.aborted) return;
                    if (data.revision !== revision) {
                        setStatus('Сцена изменилась. Синхронизируем…');
                        store.onRevisionGap?.();
                        return;
                    }
                    setResult(data);
                    store.setLosDebug(data);
                    setStatus('');
                })
                .catch((error: Error) => {
                    if (!abort.signal.aborted) setStatus(error.message);
                });
        }, 180);
        return () => {
            window.clearTimeout(timer);
            abort.abort();
            store.setLosDebug();
        };
    }, [
        store,
        scene.id,
        scene.revision,
        scene.width,
        scene.height,
        observer,
        observerId,
        targetId,
        range,
        point,
        retry,
    ]);
    const last = result?.revision === (scene.revision ?? 0) ? result.results.at(-1) : undefined;
    return (
        <aside className="los-debug-panel panel" aria-label="Проверка LOS">
            <strong>LOS · Player Vision 360°</strong>
            <label>
                <input
                    type="checkbox"
                    aria-label="Player Vision"
                    checked={!!scene.vision?.enabled}
                    disabled={saving}
                    onChange={(e) => void saveVision(e.target.checked)}
                />
                Обзор игроков
            </label>
            <label>
                Память карты
                <select
                    aria-label="Память карты"
                    value={scene.vision?.memoryPolicy ?? 'player'}
                    disabled={saving}
                    onChange={(e) =>
                        void saveVision(
                            !!scene.vision?.enabled,
                            e.target.value as 'player' | 'party',
                        )
                    }
                >
                    <option value="player">Личная · каждый игрок</option>
                    <option value="party">Общая · партия</option>
                </select>
            </label>
            <label>
                Наблюдатель
                <select
                    aria-label="LOS наблюдатель"
                    value={observerId}
                    onChange={(e) => {
                        setObserverId(e.target.value);
                        setRange(
                            scene.tokens.find((t) => t.id === e.target.value)?.visionRange ?? 600,
                        );
                    }}
                >
                    {scene.tokens.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name}
                        </option>
                    ))}
                </select>
            </label>
            <label>
                Дальность · мировые единицы
                <input
                    aria-label="Дальность LOS"
                    type="number"
                    min={0}
                    max={40000}
                    value={range}
                    onChange={(e) => setRange(Math.max(0, Math.min(40000, Number(e.target.value))))}
                />
            </label>
            <button
                disabled={saving || !observerId}
                onClick={() => void saveVision(!!scene.vision?.enabled)}
            >
                Сохранить дальность персонажа
            </button>
            <p className="hint">
                Сохранено: {observer?.visionRange ?? 600} ед. · 360°, без направления. Каждый игрок
                видит от своих персонажей. Память хранит только территорию; сущности видны сейчас.
                Ручной Fog сохраняет силу. Без наблюдателя остаётся только память карты.
            </p>
            <button
                className="secondary-button"
                disabled={saving}
                onClick={() => setResetting(true)}
            >
                Сбросить память карты…
            </button>
            {resetting && (
                <ConfirmDialog
                    title="Сбросить память карты?"
                    description="Разведанная территория всех игроков и партии в этой сцене будет забыта. Текущий обзор сразу запомнится заново. Ручной Fog сохраняется."
                    buttonLabel="Сбросить память"
                    onClose={() => setResetting(false)}
                    submit={async () => {
                        const result = await request<Mutation>(
                            `/scenes/${scene.id}/vision`,
                            'POST',
                            {
                                enabled: !!scene.vision?.enabled,
                                resetMemory: true,
                                clientMutationId: commandId(),
                            },
                        );
                        store.accept(result, true);
                    }}
                />
            )}
            <label>
                Цель
                <select
                    aria-label="LOS цель"
                    value={targetId}
                    onChange={(e) => {
                        setTargetId(e.target.value);
                        setPoint(undefined);
                    }}
                >
                    <option value="">
                        {point
                            ? `Точка ${point.x.toFixed(0)}, ${point.y.toFixed(0)}`
                            : 'Укажите точку на карте'}
                    </option>
                    {scene.tokens
                        .filter((t) => t.id !== observerId)
                        .map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                </select>
            </label>
            <p className="hint">
                Центр → центр + 8 точек footprint цели. Мятный — виден, красный — преграда, янтарный
                — вне дальности. Заливка показывает visibility polygon; лучи — точные LOS-замеры.
            </p>
            {!probing && (
                <p className="hint">
                    Для проверки кликом выберите инструмент «Выбор». Стены и двери можно править в
                    Build при включённом LOS.
                </p>
            )}
            <output aria-live="polite">
                {status ||
                    (!observer
                        ? 'В сцене нет токенов.'
                        : last && (targetId || point)
                          ? 'visibility' in last
                              ? `Цель: ${last.visibility === 'full' ? 'видна полностью' : last.visibility === 'partial' ? 'видна частично' : 'не видна'} · ${last.visibleSamples}/${last.sampleCount}`
                              : last.reason === 'clear'
                                ? 'Точка видна'
                                : last.reason === 'out_of_range'
                                  ? 'Точка вне дальности'
                                  : `Блокирует ${last.blocker?.source ?? 'геометрия'} · ${last.blocker?.id ?? ''}`
                          : 'Укажите цель. Space + drag — панорама.')}
            </output>
            <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
                Обновить проверку
            </button>
        </aside>
    );
}
