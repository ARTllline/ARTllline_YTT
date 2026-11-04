import { useEffect, useState, useSyncExternalStore } from 'react';
import { Crop, Grid2X2, Image, Maximize, Mountain, Save, X } from 'lucide-react';
import { AssetPicker } from '../../control/AssetLibrary';
import { calibrateGrid, mapSettings, mapState, type MapSettings } from '../../tabletop/mapWorld';
import type { Point } from '../../tabletop/types/scene';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import { NumberField } from '../NumberField';
import { usePanelGuard } from '../ui/PanelGuard';
import '../../../css/map-preparation.css';

export function MapPreparation({
    store,
    queue,
    active,
    onClose,
    onFit,
}: {
    store: SceneStore;
    queue: SaveQueue;
    active: boolean;
    onClose: () => void;
    onFit: () => void;
}) {
    const { scene } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const [initial] = useState(() => mapState(mapSettings(scene), !!scene.mapWorld));
    const [draft, setDraft] = useState<MapSettings>(() => mapSettings(scene));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [discard, setDiscard] = useState(false);
    const [calibrating, setCalibrating] = useState(false);
    const [points, setPoints] = useState<Point[]>([]);
    const [cells, setCells] = useState(5);
    const dirty = JSON.stringify(mapState(draft, initial.enabled)) !== JSON.stringify(initial);
    usePanelGuard(
        busy
            ? 'Дождитесь сохранения карты или повторите неудавшийся запрос.'
            : dirty
              ? 'Сохраните карту или закройте редактор, отменив изменения.'
              : '',
    );
    useEffect(() => {
        store.previewMap(draft, points);
    }, [store, draft, points]);
    useEffect(
        () => () => {
            store.previewMap(null);
            store.bindMapCalibration();
        },
        [store],
    );
    useEffect(() => {
        if (!calibrating) return;
        store.bindMapCalibration((point) => {
            if (!points.length) setPoints([point]);
            else {
                setPoints([points[0], point]);
                try {
                    const grid = calibrateGrid(points[0], point, cells);
                    setDraft((d) => ({ ...d, grid: { ...d.grid, ...grid, visible: true } }));
                    setError('');
                } catch (e) {
                    setError((e as Error).message);
                }
                setCalibrating(false);
            }
        });
        return () => {
            store.bindMapCalibration();
        };
    }, [store, calibrating, points, cells]);
    const map = draft.map;
    const updateMap = (patch: Partial<NonNullable<MapSettings['map']>>) => {
        if (map) setDraft({ ...draft, map: { ...map, ...patch } });
    };
    const submit = async () => {
        setBusy(true);
        setError('');
        setCalibrating(false);
        try {
            await store.saveMapWorld(draft, initial);
            onClose();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <aside className="map-preparation panel" aria-label="Подготовка карты">
            <div className="panel-heading">
                <span>
                    <Mountain size={16} /> Подготовка карты
                </span>
                <button
                    className="icon-button"
                    aria-label="Закрыть подготовку карты"
                    disabled={busy}
                    onClick={() => (dirty ? setDiscard(true) : onClose())}
                >
                    <X size={16} />
                </button>
            </div>
            <div className="map-preparation-intro">
                <span className="eyebrow">
                    {scene.mapWorld ? 'РЕДАКТИРУЕМАЯ КАРТА' : 'НОВАЯ РЕДАКТИРУЕМАЯ КАРТА'}
                </span>
                <h2>{scene.name}</h2>
                <p>
                    Основа вашего мира. Настройте пространство и совместите сетку с изображением
                    прямо на столе.
                </p>
                {active && (
                    <p className="map-live-notice">
                        Сцена в эфире. Изменения увидят игроки после сохранения.
                    </p>
                )}
            </div>
            <fieldset disabled={busy || save.status !== 'saved'} className="map-preparation-fields">
                <section>
                    <div className="map-section-title">
                        <h3>
                            <Maximize size={15} /> Пространство
                        </h3>
                        <button type="button" className="text-button" onClick={onFit}>
                            Показать целиком
                        </button>
                    </div>
                    <div className="field-row">
                        <NumberField
                            label="Ширина мира"
                            value={draft.width}
                            min={120}
                            max={20000}
                            onChange={(width) => setDraft({ ...draft, width })}
                        />
                        <NumberField
                            label="Высота мира"
                            value={draft.height}
                            min={120}
                            max={20000}
                            onChange={(height) => setDraft({ ...draft, height })}
                        />
                    </div>
                    <p className="hint">
                        Границы начинаются в 0, 0. Токены и объекты сохраняют свои позиции.
                    </p>
                    {(draft.width < scene.width || draft.height < scene.height) && (
                        <p className="map-live-notice">
                            При сохранении проверим, что новые границы не исключают токены или
                            объекты.
                        </p>
                    )}
                </section>
                <section>
                    <h3>
                        <Image size={15} /> Изображение-основа
                    </h3>
                    <AssetPicker
                        value={map?.asset}
                        category="maps"
                        label={map ? 'Заменить изображение' : 'Выбрать из Assets'}
                        onChange={(asset) =>
                            setDraft({
                                ...draft,
                                map: {
                                    asset,
                                    x: 0,
                                    y: 0,
                                    width: Math.min(20000, asset.width),
                                    height: Math.min(20000, asset.height),
                                },
                            })
                        }
                    />
                    {map ? (
                        <>
                            <div className="map-image-actions">
                                <button
                                    className="text-button"
                                    onClick={() =>
                                        updateMap({
                                            x: (draft.width - map.width) / 2,
                                            y: (draft.height - map.height) / 2,
                                        })
                                    }
                                >
                                    По центру
                                </button>
                                <button
                                    className="text-button"
                                    onClick={() => {
                                        const scale = Math.min(
                                            draft.width / map.asset.width,
                                            draft.height / map.asset.height,
                                        );
                                        updateMap({
                                            width: map.asset.width * scale,
                                            height: map.asset.height * scale,
                                            x: (draft.width - map.asset.width * scale) / 2,
                                            y: (draft.height - map.asset.height * scale) / 2,
                                        });
                                    }}
                                >
                                    Вписать
                                </button>
                                <button
                                    className="text-button"
                                    onClick={() => setDraft({ ...draft, map: null })}
                                >
                                    Без изображения
                                </button>
                            </div>
                            <div className="field-row">
                                <NumberField
                                    label="Основа X"
                                    value={map.x}
                                    onChange={(x) => updateMap({ x })}
                                />
                                <NumberField
                                    label="Основа Y"
                                    value={map.y}
                                    onChange={(y) => updateMap({ y })}
                                />
                            </div>
                            <NumberField
                                label="Масштаб основы, %"
                                value={(map.width / map.asset.width) * 100}
                                min={0.1}
                                step={0.1}
                                onChange={(percent) =>
                                    updateMap({
                                        width: (map.asset.width * percent) / 100,
                                        height: (map.asset.height * percent) / 100,
                                    })
                                }
                            />
                            <details>
                                <summary>
                                    <Crop size={14} /> Кадр и точные размеры
                                </summary>
                                <div className="field-row">
                                    <NumberField
                                        label="Ширина основы"
                                        value={map.width}
                                        min={1}
                                        max={20000}
                                        onChange={(width) => updateMap({ width })}
                                    />
                                    <NumberField
                                        label="Высота основы"
                                        value={map.height}
                                        min={1}
                                        max={20000}
                                        onChange={(height) => updateMap({ height })}
                                    />
                                </div>
                                <p className="hint">
                                    Кадр скрывает края, сохраняя масштаб. Исходный файл не меняется.
                                </p>
                                <div className="field-row">
                                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                                        <NumberField
                                            key={key}
                                            label={
                                                {
                                                    x: 'Кадр X, %',
                                                    y: 'Кадр Y, %',
                                                    width: 'Кадр ширина, %',
                                                    height: 'Кадр высота, %',
                                                }[key]
                                            }
                                            value={
                                                (map.crop ?? { x: 0, y: 0, width: 1, height: 1 })[
                                                    key
                                                ] * 100
                                            }
                                            min={key === 'x' || key === 'y' ? 0 : 0.1}
                                            max={100}
                                            step={0.1}
                                            onChange={(v) =>
                                                updateMap({
                                                    crop: {
                                                        x: 0,
                                                        y: 0,
                                                        width: 1,
                                                        height: 1,
                                                        ...map.crop,
                                                        [key]: v / 100,
                                                    },
                                                })
                                            }
                                        />
                                    ))}
                                </div>
                                <button
                                    className="text-button"
                                    onClick={() => updateMap({ crop: null })}
                                >
                                    Показать изображение целиком
                                </button>
                            </details>
                        </>
                    ) : (
                        <p className="hint">Чистый мир — изображение можно добавить позже.</p>
                    )}
                </section>
                <section>
                    <h3>
                        <Grid2X2 size={15} /> Совмещение сетки
                    </h3>
                    <div className="map-calibration">
                        <NumberField
                            label="Клеток между точками"
                            value={cells}
                            min={1}
                            onChange={setCells}
                        />
                        <button
                            className="secondary-button"
                            aria-pressed={calibrating}
                            onClick={() => {
                                setPoints([]);
                                setCalibrating(!calibrating);
                            }}
                        >
                            {calibrating ? 'Отменить замер' : 'Указать две точки на карте'}
                        </button>
                        <p className="hint">
                            {calibrating
                                ? points.length
                                    ? 'Теперь укажите второй узел. Space + drag — перемещение вида.'
                                    : 'Укажите узел сетки изображения, затем другой узел вдоль той же линии.'
                                : 'Замерьте несколько клеток изображения. Первый узел задаст начало сетки.'}
                        </p>
                    </div>
                    <div className="field-row">
                        <NumberField
                            label="Размер клетки"
                            value={draft.grid.size}
                            min={20}
                            max={160}
                            step={0.1}
                            onChange={(size) =>
                                setDraft({ ...draft, grid: { ...draft.grid, size } })
                            }
                        />
                        <NumberField
                            label="Расстояние в клетке"
                            value={draft.grid.distancePerCell ?? 5}
                            min={0.1}
                            step={0.1}
                            onChange={(distancePerCell) =>
                                setDraft({ ...draft, grid: { ...draft.grid, distancePerCell } })
                            }
                        />
                    </div>
                    <div className="field-row">
                        <NumberField
                            label="Сетка X"
                            value={draft.grid.offset.x}
                            step={0.1}
                            onChange={(x) =>
                                setDraft({
                                    ...draft,
                                    grid: { ...draft.grid, offset: { ...draft.grid.offset, x } },
                                })
                            }
                        />
                        <NumberField
                            label="Сетка Y"
                            value={draft.grid.offset.y}
                            step={0.1}
                            onChange={(y) =>
                                setDraft({
                                    ...draft,
                                    grid: { ...draft.grid, offset: { ...draft.grid.offset, y } },
                                })
                            }
                        />
                    </div>
                    <label className="field">
                        <span>Единицы расстояния</span>
                        <select
                            value={draft.grid.distanceUnit ?? 'ft'}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    grid: { ...draft.grid, distanceUnit: e.target.value },
                                })
                            }
                        >
                            <option value="ft">Футы</option>
                            <option value="m">Метры</option>
                            <option value="squares">Клетки</option>
                        </select>
                    </label>
                    <label className="toggle-row">
                        <input
                            type="checkbox"
                            checked={draft.grid.visible}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    grid: { ...draft.grid, visible: e.target.checked },
                                })
                            }
                        />{' '}
                        Показывать сетку
                    </label>
                    <label className="toggle-row">
                        <input
                            type="checkbox"
                            checked={draft.grid.snap}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    grid: { ...draft.grid, snap: e.target.checked },
                                })
                            }
                        />{' '}
                        Привязка к сетке
                    </label>
                    <p className="hint">
                        Сетка измеряет мир. Её настройка не растягивает карту или объекты.
                    </p>
                </section>
            </fieldset>
            <div className="map-preparation-footer">
                {error && <p role="alert">{error}</p>}
                {save.status === 'failed' && (
                    <button className="secondary-button" onClick={queue.retry}>
                        Повторить сохранение
                    </button>
                )}
                {discard ? (
                    <div>
                        <p>Отменить несохранённые изменения?</p>
                        <button className="text-button" onClick={onClose}>
                            Отменить изменения
                        </button>
                        <button className="text-button" onClick={() => setDiscard(false)}>
                            Продолжить
                        </button>
                    </div>
                ) : (
                    <button
                        className="primary-button"
                        disabled={busy || save.status !== 'saved'}
                        onClick={() => void submit()}
                    >
                        <Save size={15} />{' '}
                        {busy ? 'Сохраняем…' : scene.mapWorld ? 'Сохранить карту' : 'Создать карту'}
                    </button>
                )}
            </div>
        </aside>
    );
}
