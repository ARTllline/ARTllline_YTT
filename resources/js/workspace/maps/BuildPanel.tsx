import { useEffect, useState, useSyncExternalStore } from 'react';
import { BrickWall } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import {
    defaultBuild,
    putOpening,
    structureOf,
    type Opening,
} from '../../tabletop/structure/model';
import { DoorControls } from './DoorControls';
import { materials, type Material } from './materials';

export function BuildPanel({
    store,
    onTool,
    onSettings,
}: {
    store: SceneStore;
    onTool: () => void;
    onSettings: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const tool = useSyncExternalStore(store.spatial.subscribe, store.spatial.getTool);
    const settings = state.build ?? defaultBuild;
    const selection = state.structureSelection;
    const graph = structureOf(state.scene);
    const selectedEdge =
        selection?.kind === 'edge' && graph.edges.find((e) => e.id === selection.id);
    const selectedRoom =
        selection?.kind === 'room' && graph.rooms.find((r) => r.id === selection.id);
    const selectedVertex =
        selection?.kind === 'vertex' && graph.vertices.some((v) => v.id === selection.id);
    const opening =
        selection?.kind === 'opening' && graph.openings?.find((o) => o.id === selection.id);
    const placing = settings.mode === 'door' || settings.mode === 'window';
    const canJoin =
        selectedVertex &&
        graph.edges.filter((e) => e.a === selection.id || e.b === selection.id).length === 2;
    const choose = (mode: typeof settings.mode) => {
        onTool();
        store.configureBuild({ mode });
    };
    return (
        <aside className="map-editor-panel panel build-panel" aria-label="Build">
            <div className="panel-heading">
                <span>Build · архитектура</span>
                <BrickWall size={16} />
            </div>
            <div className="map-editor-panel-body">
                {!state.scene.mapWorld ? (
                    <button className="primary-button" onClick={onSettings}>
                        Создать MapWorld
                    </button>
                ) : (
                    <>
                        <div className="build-tools" role="group" aria-label="Инструменты Build">
                            {(
                                [
                                    ['wall', 'Стены'],
                                    ['segment', 'Сегмент'],
                                    ['rectangle', 'Комната'],
                                    ['contour', 'Контур'],
                                    ['edit', 'Правка'],
                                    ['door', 'Дверь'],
                                    ['window', 'Окно'],
                                ] as const
                            ).map(([mode, label]) => (
                                <button
                                    key={mode}
                                    aria-pressed={tool === 'build' && settings.mode === mode}
                                    onClick={() => choose(mode)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <p className="build-hint">
                            {
                                {
                                    wall: 'Ставьте вершины кликами. Enter или двойной клик завершает стену.',
                                    segment: 'Протяните стену или отметьте две точки.',
                                    rectangle:
                                        'Протяните комнату или отметьте два противоположных угла.',
                                    contour:
                                        'Поставьте углы. Замкните на первой точке или нажмите Enter.',
                                    edit: 'Потяните вершину, стену или проём. Клик внутри контура выбирает комнату.',
                                    door: 'Наведите курсор на стену и кликните, чтобы встроить дверь.',
                                    window: 'Наведите курсор на стену и кликните, чтобы встроить окно.',
                                }[settings.mode]
                            }{' '}
                            Esc отменяет жест.
                        </p>
                        {placing && (
                            <label className="build-field">
                                Ширина проёма · {settings.openingWidth} wu
                                <input
                                    type="range"
                                    aria-label="Ширина нового проёма"
                                    min={8}
                                    max={512}
                                    value={settings.openingWidth}
                                    onChange={(e) =>
                                        store.configureBuild({
                                            openingWidth: Number(e.target.value),
                                        })
                                    }
                                />
                            </label>
                        )}
                        {!placing && !opening && (
                            <>
                                <label className="build-field">
                                    Толщина · {settings.thickness} wu
                                    <input
                                        aria-label="Толщина стены"
                                        type="range"
                                        min={2}
                                        max={80}
                                        step={1}
                                        value={settings.thickness}
                                        onChange={(e) =>
                                            store.configureBuild({
                                                thickness: Number(e.target.value),
                                            })
                                        }
                                    />
                                </label>
                                <SurfacePicker
                                    type="wall"
                                    value={settings.wall}
                                    onChange={(wall) => store.configureBuild({ wall })}
                                />
                                {(settings.mode === 'rectangle' ||
                                    settings.mode === 'contour' ||
                                    settings.mode === 'edit') && (
                                    <SurfacePicker
                                        type="floor"
                                        value={settings.floor}
                                        onChange={(floor) => store.configureBuild({ floor })}
                                    />
                                )}
                                <label className="build-check">
                                    <input
                                        type="checkbox"
                                        checked={settings.gridSnap}
                                        onChange={(e) =>
                                            store.configureBuild({ gridSnap: e.target.checked })
                                        }
                                    />{' '}
                                    Привязка к узлам сетки
                                </label>
                                <p className="build-hint">○ Вершина · ◇ Стена · □ Сетка</p>
                            </>
                        )}
                        {tool === 'build' && settings.mode === 'edit' && opening && (
                            <OpeningInspector
                                key={opening.id}
                                opening={opening}
                                store={store}
                                save={(value) => store.saveStructure(putOpening(graph, value))}
                            />
                        )}
                        {tool === 'build' &&
                            settings.mode === 'edit' &&
                            (selectedEdge || selectedRoom || selectedVertex) && (
                                <div className="build-selection">
                                    <strong>
                                        {selectedEdge
                                            ? 'Стена'
                                            : selectedRoom
                                              ? 'Комната'
                                              : 'Вершина'}
                                    </strong>
                                    <div className="build-tools">
                                        {selectedEdge && (
                                            <button
                                                onClick={() => store.onStructureAction?.('split')}
                                            >
                                                Разделить пополам
                                            </button>
                                        )}
                                        {selectedEdge && (
                                            <button
                                                onClick={() => store.onStructureAction?.('reverse')}
                                            >
                                                Развернуть ребро
                                            </button>
                                        )}
                                        {canJoin && (
                                            <button
                                                onClick={() => store.onStructureAction?.('join')}
                                            >
                                                Соединить стены
                                            </button>
                                        )}
                                        {(selectedEdge || selectedRoom) && (
                                            <button
                                                onClick={() => store.onStructureAction?.('apply')}
                                            >
                                                {selectedEdge ? 'Применить стену' : 'Применить пол'}
                                            </button>
                                        )}
                                        <button onClick={() => store.onStructureAction?.('delete')}>
                                            {selectedRoom
                                                ? 'Удалить комнату, оставить стены'
                                                : 'Удалить'}
                                        </button>
                                    </div>
                                </div>
                            )}
                    </>
                )}
            </div>
        </aside>
    );
}

function OpeningInspector({
    opening,
    save,
    store,
}: {
    opening: Opening;
    save: (value: Opening) => void;
    store: SceneStore;
}) {
    return (
        <div className="build-selection">
            <strong>{opening.type === 'door' ? 'Дверь' : 'Окно'}</strong>
            <label className="build-field">
                Ширина (wu)
                <input
                    key={opening.width}
                    type="number"
                    min={8}
                    max={512}
                    defaultValue={opening.width}
                    onBlur={(e) => {
                        const width = e.target.valueAsNumber;
                        e.target.value = String(opening.width);
                        if (Number.isFinite(width) && width !== opening.width)
                            save({ ...opening, width });
                    }}
                />
            </label>
            {opening.type === 'door' ? (
                <>
                    <DoorControls door={opening} store={store} />
                    <label className="build-field">
                        Петля
                        <select
                            value={opening.hinge}
                            onChange={(e) =>
                                save({ ...opening, hinge: e.target.value === 'a' ? 'a' : 'b' })
                            }
                        >
                            <option value="a">Начало ребра</option>
                            <option value="b">Конец ребра</option>
                        </select>
                    </label>
                    <label className="build-field">
                        Сторона открывания
                        <select
                            value={opening.direction}
                            onChange={(e) =>
                                save({
                                    ...opening,
                                    direction: e.target.value === 'left' ? 'left' : 'right',
                                })
                            }
                        >
                            <option value="left">По нормали</option>
                            <option value="right">Против нормали</option>
                        </select>
                    </label>
                    <label className="build-field">
                        Угол (°)
                        <input
                            key={opening.angle}
                            type="number"
                            min={30}
                            max={150}
                            defaultValue={opening.angle}
                            onBlur={(e) => {
                                const angle = e.target.valueAsNumber;
                                e.target.value = String(opening.angle);
                                if (angle >= 30 && angle <= 150 && angle !== opening.angle)
                                    save({ ...opening, angle });
                            }}
                        />
                    </label>
                </>
            ) : (
                <>
                    <label className="build-field">
                        Рама
                        <select
                            value={opening.frame}
                            onChange={(e) =>
                                save({
                                    ...opening,
                                    frame: e.target.value === 'iron' ? 'iron' : 'wood',
                                })
                            }
                        >
                            <option value="wood">Дерево</option>
                            <option value="iron">Металл</option>
                        </select>
                    </label>
                    {(
                        [
                            ['blocksMovement', 'Блокирует движение'],
                            ['blocksVision', 'Блокирует обзор'],
                            ['blocksLight', 'Блокирует свет'],
                        ] as const
                    ).map(([field, label]) => (
                        <label className="build-check" key={field}>
                            <input
                                type="checkbox"
                                checked={opening[field] ?? false}
                                onChange={(e) => save({ ...opening, [field]: e.target.checked })}
                            />{' '}
                            {label}
                        </label>
                    ))}
                </>
            )}
            <button onClick={() => store.onStructureAction?.('delete')}>Удалить проём</button>
        </div>
    );
}

function SurfacePicker({
    type,
    value,
    onChange,
}: {
    type: 'wall' | 'floor';
    value: string | null;
    onChange: (id: string | null) => void;
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState<{ materials: Material[]; pages: number }>();
    const [selected, setSelected] = useState<Material>();
    const [error, setError] = useState('');
    const label = type === 'wall' ? 'Материал стены' : 'Материал пола';
    useEffect(() => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            void materials
                .list(search, type, page, controller.signal)
                .then((result) => {
                    if (!controller.signal.aborted) {
                        setData(result);
                        setError('');
                    }
                })
                .catch((e: Error) => {
                    if (!controller.signal.aborted) setError(e.message);
                });
        }, 150);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [search, type, page]);
    const list = data?.materials ?? [];
    return (
        <div className="build-field">
            <label>
                {label}
                <select
                    aria-label={label}
                    value={value ?? ''}
                    onChange={(e) => {
                        setSelected(list.find((m) => m.versionId === e.target.value));
                        onChange(e.target.value || null);
                    }}
                >
                    <option value="">{type === 'wall' ? 'Нейтральная кладка' : 'Без пола'}</option>
                    {value && !list.some((m) => m.versionId === value) && (
                        <option value={value}>{selected?.name ?? `Версия #${value}`}</option>
                    )}
                    {list.map((m) => (
                        <option key={m.versionId} value={m.versionId}>
                            {m.name}
                        </option>
                    ))}
                </select>
            </label>
            <div className="build-material-search">
                <input
                    type="search"
                    aria-label={`Поиск · ${label}`}
                    placeholder="Поиск в библиотеке"
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                    }}
                />
                {(data?.pages ?? 0) > 1 && (
                    <>
                        <button
                            aria-label="Предыдущая страница"
                            disabled={page <= 1}
                            onClick={() => setPage(page - 1)}
                        >
                            ‹
                        </button>
                        <button
                            aria-label="Следующая страница"
                            disabled={page >= data!.pages}
                            onClick={() => setPage(page + 1)}
                        >
                            ›
                        </button>
                    </>
                )}
            </div>
            {error && <small role="alert">{error}</small>}
        </div>
    );
}
