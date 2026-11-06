import '../../../css/lighting.css';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Flame, Moon, Plus, Sun, Trash2, Crosshair } from 'lucide-react';
import { request } from '../../api/client';
import { commandId, type Mutation } from '../../api/workspace';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import { defaultLighting, type LightSource } from '../../tabletop/lighting/model';

export function LightingPanel({
    store,
    queue,
    guard: guardRef,
}: {
    store: SceneStore;
    queue: SaveQueue;
    guard: { current: string };
}) {
    const { scene, selectedIds } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [expected, setExpected] = useState(scene.lighting ?? defaultLighting);
    const [value, setValue] = useState(expected);
    const [selected, setSelected] = useState(value.sources?.[0]?.id ?? '');
    const [placing, setPlacing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('');
    const sources = value.sources ?? [];
    const source = sources.find((s) => s.id === selected);
    const dirty = JSON.stringify(value) !== JSON.stringify(expected);
    useEffect(() => {
        guardRef.current = dirty ? 'Сохраните или отмените настройки освещения.' : '';
        store.setLightingDraft(value);
        return () => {
            guardRef.current = '';
            store.setLightingDraft();
        };
    }, [value, dirty, guardRef, store]);
    useEffect(() => {
        if (!placing || !source || saving) return;
        store.bindLightPlacement((point) => {
            setValue((v) => ({
                ...v,
                sources: v.sources?.map((s) =>
                    s.id === selected
                        ? {
                              ...s,
                              tokenId: null,
                              x: Math.round(Math.max(0, Math.min(scene.width, point.x))),
                              y: Math.round(Math.max(0, Math.min(scene.height, point.y))),
                          }
                        : s,
                ),
            }));
            setPlacing(false);
        });
        return () => {
            store.bindLightPlacement();
        };
    }, [placing, source, saving, store, selected, scene.width, scene.height]);
    const patch = (patch: Partial<LightSource>) =>
        setValue({
            ...value,
            sources: sources.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
        });
    const save = async () => {
        setSaving(true);
        setStatus('');
        setPlacing(false);
        try {
            await queue.flush();
            const result = await request<Mutation>(`/scenes/${scene.id}/lighting`, 'PUT', {
                value,
                expected,
                clientMutationId: commandId(),
            });
            store.accept(result, true);
            setExpected(result.lighting!);
            setValue(result.lighting!);
            setStatus('Освещение сохранено');
        } catch (error) {
            setStatus((error as Error).message);
        } finally {
            setSaving(false);
        }
    };
    return (
        <aside className="lighting-panel panel" aria-label="Освещение карты">
            <header>
                <Flame size={18} />
                <strong>Освещение</strong>
            </header>
            <p className="hint">
                Свет и тени создают атмосферу. Обзор игроков настраивается отдельно.
            </p>
            <fieldset disabled={saving}>
                <label className="check-field">
                    <input
                        type="checkbox"
                        checked={value.enabled}
                        onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
                    />
                    Динамический свет
                </label>
                <div className="lighting-presets">
                    <button
                        aria-pressed={value.mode === 'day'}
                        onClick={() =>
                            setValue({
                                ...value,
                                enabled: true,
                                mode: 'day',
                                brightness: 1,
                                color: '#fff4df',
                            })
                        }
                    >
                        <Sun size={15} /> День
                    </button>
                    <button
                        aria-pressed={value.mode === 'night'}
                        onClick={() =>
                            setValue({
                                ...value,
                                enabled: true,
                                mode: 'night',
                                brightness: 0.12,
                                color: '#829bd4',
                            })
                        }
                    >
                        <Moon size={15} /> Ночь
                    </button>
                </div>
                <label>
                    Фоновая яркость <output>{Math.round(value.brightness * 100)}%</output>
                    <input
                        aria-label="Фоновая яркость"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={value.brightness}
                        onChange={(e) => setValue({ ...value, brightness: +e.target.value })}
                    />
                </label>
                <label className="lighting-color">
                    Цвет фона
                    <input
                        aria-label="Цвет фона"
                        type="color"
                        value={value.color}
                        onChange={(e) => setValue({ ...value, color: e.target.value })}
                    />
                </label>
                <div className="lighting-heading">
                    <strong>Источники · {sources.length}/16</strong>
                    <button
                        aria-label="Добавить факел"
                        disabled={sources.length >= 16}
                        onClick={() => {
                            const token = scene.tokens.find((t) => selectedIds.includes(t.id));
                            const light: LightSource = {
                                id: crypto.randomUUID(),
                                name: `Факел ${sources.length + 1}`,
                                enabled: true,
                                x: token?.x ?? Math.round(scene.width / 2),
                                y: token?.y ?? Math.round(scene.height / 2),
                                tokenId: token?.id ?? null,
                                radius: 420,
                                color: '#ffc078',
                                intensity: 1.2,
                                falloff: 1,
                            };
                            setValue({ ...value, enabled: true, sources: [...sources, light] });
                            setSelected(light.id);
                        }}
                    >
                        <Plus size={15} /> Факел
                    </button>
                </div>
                <div className="lighting-sources">
                    {sources.map((s) => (
                        <button
                            key={s.id}
                            aria-pressed={s.id === selected}
                            onClick={() => {
                                setSelected(s.id);
                                setPlacing(false);
                            }}
                        >
                            <i style={{ background: s.color }} />
                            {s.name}
                            <small>
                                {s.tokenId ? 'Токен' : 'Карта'}
                                {!s.enabled && ' · выкл.'}
                            </small>
                        </button>
                    ))}
                </div>
                {!sources.length && (
                    <p className="hint">
                        Добавьте факел и укажите место на карте. Выбранный токен станет его
                        носителем.
                    </p>
                )}
                {source && (
                    <div className="lighting-source-editor">
                        <label>
                            Название
                            <input
                                aria-label="Название источника"
                                maxLength={80}
                                value={source.name}
                                onChange={(e) => patch({ name: e.target.value })}
                            />
                        </label>
                        <label className="check-field">
                            <input
                                type="checkbox"
                                checked={source.enabled}
                                onChange={(e) => patch({ enabled: e.target.checked })}
                            />
                            Включён
                        </label>
                        <label>
                            Привязка к токену
                            <select
                                aria-label="Привязка света"
                                value={source.tokenId ?? ''}
                                onChange={(e) => {
                                    const token = scene.tokens.find((t) => t.id === e.target.value);
                                    patch({
                                        tokenId: token?.id ?? null,
                                        x: token?.x ?? source.x,
                                        y: token?.y ?? source.y,
                                    });
                                }}
                            >
                                <option value="">На карте</option>
                                {scene.tokens.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                        {t.isHidden ? ' · скрыт' : ''}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {!source.tokenId && (
                            <>
                                <div className="lighting-coordinates">
                                    {(['x', 'y'] as const).map((axis) => (
                                        <label key={axis}>
                                            {axis.toUpperCase()}
                                            <input
                                                aria-label={`Свет ${axis.toUpperCase()}`}
                                                type="number"
                                                min="0"
                                                max={axis === 'x' ? scene.width : scene.height}
                                                value={source[axis]}
                                                onChange={(e) => patch({ [axis]: +e.target.value })}
                                            />
                                        </label>
                                    ))}
                                </div>
                                <button aria-pressed={placing} onClick={() => setPlacing(!placing)}>
                                    <Crosshair size={15} />
                                    {placing ? 'Нажмите на карту…' : 'Указать на карте'}
                                </button>
                            </>
                        )}
                        <label>
                        Радиус · единицы карты
                            <input
                                aria-label="Радиус света"
                                type="number"
                                min="2"
                                max="40000"
                                value={source.radius}
                                onChange={(e) => patch({ radius: +e.target.value })}
                            />
                        </label>
                        <label className="lighting-color">
                            Цвет света
                            <input
                                aria-label="Цвет света"
                                type="color"
                                value={source.color}
                                onChange={(e) => patch({ color: e.target.value })}
                            />
                        </label>
                        <label>
                            Интенсивность <output>{source.intensity.toFixed(2)}</output>
                            <input
                                aria-label="Интенсивность света"
                                type="range"
                                min="0"
                                max="3"
                                step="0.05"
                                value={source.intensity}
                                onChange={(e) => patch({ intensity: +e.target.value })}
                            />
                        </label>
                        <label>
                            Затухание <output>{source.falloff.toFixed(2)}</output>
                            <input
                                aria-label="Затухание света"
                                type="range"
                                min="0.25"
                                max="4"
                                step="0.05"
                                value={source.falloff}
                                onChange={(e) => patch({ falloff: +e.target.value })}
                            />
                        </label>
                        <button
                            className="danger"
                            onClick={() => {
                                setValue({
                                    ...value,
                                    sources: sources.filter((s) => s.id !== selected),
                                });
                                setSelected(sources.find((s) => s.id !== selected)?.id ?? '');
                            }}
                        >
                            <Trash2 size={14} />
                            Удалить источник
                        </button>
                    </div>
                )}
            </fieldset>
            <footer>
                <button
                    disabled={!dirty || saving || sources.some((s) => !s.name.trim())}
                    onClick={() => void save()}
                >
                    {saving ? 'Сохраняем…' : 'Сохранить свет'}
                </button>
                <button
                    disabled={saving}
                    onClick={() => {
                        const current = scene.lighting ?? defaultLighting;
                        setExpected(current);
                        setValue(current);
                        setPlacing(false);
                        setStatus('');
                    }}
                >
                    Сбросить правки
                </button>
            </footer>
            {status && <p role="status">{status}</p>}
            <small className="hint">
                Фон показан в предпросмотре. Тени и источники обновятся после сохранения.
            </small>
        </aside>
    );
}
