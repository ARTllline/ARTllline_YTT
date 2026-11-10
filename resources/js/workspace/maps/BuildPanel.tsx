import { CurveInspector } from './CurveInspector';
import { RoomSourceInspector } from './RoomSourceInspector';
import { isOpenCurve } from '../../tabletop/structure/curves';
import { useState, useSyncExternalStore } from 'react';
import {
    BrickWall,
    Circle,
    CircleDashed,
    Orbit,
    DoorOpen,
    Grid2X2,
    Minus,
    MousePointer2,
    Pentagon,
    PaintBucket,
    Square,
    X,
} from 'lucide-react';
import { selectedWalls } from '../../tabletop/structure/buildSelection';
import { selectionAnchors, type BuildAnchor } from '../../tabletop/structure/buildAnchors';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import {
    defaultBuild,
    putOpening,
    structureOf,
    type BuildSettings,
    type Opening,
    type Room,
    type Surface,
    type Wall,
} from '../../tabletop/structure/model';
import { BuildMaterialPicker, type BuildMaterialHistory } from './BuildMaterialPicker';
import { DoorControls } from './DoorControls';
import { NumberField } from '../NumberField';
import { EditorOptions } from './EditorOptions';

const modes = [
    ['wall', 'Стены', BrickWall],
    ['segment', 'Сегмент', Minus],
    ['rectangle', 'Комната', Square],
    ['contour', 'Контур', Pentagon],
    ['circle', 'Круг', Circle],
    ['ellipse', 'Овал', Orbit],
    ['arc', 'Дуга', CircleDashed],
    ['edit', 'Правка', MousePointer2],
    ['floor', 'Пол', PaintBucket],
    ['door', 'Дверь', DoorOpen],
    ['window', 'Окно', Grid2X2],
] as const;

const hints: Record<BuildSettings['mode'], string> = {
    wall: 'Клик — вершина · Enter / двойной клик — закончить',
    segment: 'Протяните стену или отметьте две точки',
    rectangle: 'Протяните комнату или отметьте два угла',
    contour: 'Отметьте углы · Enter / первая точка — замкнуть',
    circle: 'От центра протяните радиус или отметьте две точки',
    ellipse: 'От центра протяните два радиуса овала',
    arc: 'Центр → начало (радиус) → конец дуги по часовой стрелке · Enter — полукруг',
    edit: 'Клик — выбор · перетащите выделение или протяните рамку',
    floor: 'Выберите материал · наведите на помещение · клик — залить / сменить пол',
    door: 'Клик по стене — дверь · Esc — закончить',
    window: 'Клик по стене — окно · Esc — закончить',
};

const limit = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function BuildPanel({
    store,
    history,
    showInspector,
    onTool,
    onSettings,
}: {
    store: SceneStore;
    history: BuildMaterialHistory;
    showInspector: boolean;
    onTool: () => void;
    onSettings: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const tool = useSyncExternalStore(store.spatial.subscribe, store.spatial.getTool);
    const settings = state.build ?? defaultBuild;
    const { mode } = settings;
    const active = tool === 'build';
    const selection = active && mode === 'edit' ? state.structureSelection : undefined;
    const graph = structureOf(state.scene);
    const surfaces = state.scene.structure?.materials;
    const walls = selectedWalls(graph, selection);
    const sourceAssembly = graph.assemblies?.find((a) => walls[0]?.id.startsWith(a.id + '-e'));
    const sourceIndex = sourceAssembly
        ? Number(walls[0].id.slice(sourceAssembly.id.length + 2).split('x')[0])
        : undefined;
    const selectedCurve =
        walls[0]?.curve && walls.every((e) => e.curve?.group === walls[0].curve!.group)
            ? walls[0].curve
            : undefined;
    const openCurve = selectedCurve && isOpenCurve(graph, selectedCurve.group);
    const room = selection?.kind === 'room' && graph.rooms.find((r) => r.id === selection.id);
    const selectedVertex =
        selection?.kind === 'vertex' && graph.vertices.some((v) => v.id === selection.id);
    const opening =
        selection?.kind === 'opening' && graph.openings?.find((o) => o.id === selection.id);
    const surfaceKey = (objects: (Wall | Room)[]) =>
        objects
            .map((object) =>
                [
                    object.id,
                    object.materialVersionId,
                    'thickness' in object ? object.thickness : '',
                ].join('/'),
            )
            .join(':');
    const placing = mode === 'door' || mode === 'window';
    const drawing = !placing && mode !== 'edit' && mode !== 'floor';
    const canJoin =
        selectedVertex &&
        graph.edges.filter((e) => e.a === selection.id || e.b === selection.id).length === 2;
    const action = store.onStructureAction;

    if (!state.scene.mapWorld)
        return (
            <div className="build-dock surface">
                <button className="primary-button" onClick={onSettings}>
                    Создать MapWorld
                </button>
            </div>
        );
    return (
        <>
            {state.roomProposal && (
                <div
                    className="build-room-choice surface"
                    role="group"
                    aria-label="Пересечение помещений"
                >
                    <strong>Пересечение помещений</strong>
                    <small>
                        Выберите границу пристройки. Предпросмотр на карте · Esc — отмена.
                    </small>
                    {(
                        [
                            ['union', 'Объединить помещения'],
                            ['partition', 'Оставить перегородку'],
                            ['trim', 'Обрезать пересекающуюся часть'],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            aria-pressed={state.roomProposal!.mode === value}
                            onClick={() => store.previewRoom(value)}
                        >
                            {label}
                        </button>
                    ))}
                    {state.roomProposal.error && (
                        <small role="alert">{state.roomProposal.error}</small>
                    )}
                    <button
                        className="primary-button"
                        disabled={!state.roomProposal.preview || !!state.roomProposal.error}
                        onClick={() => store.resolveRoom(true)}
                    >
                        Применить соединение
                    </button>
                    <button onClick={() => store.resolveRoom(false)}>Отменить соединение</button>
                </div>
            )}
            <div className="build-dock surface" aria-label="Build">
                <div className="build-tools" role="group" aria-label="Инструменты Build">
                    {modes.map(([value, label, Icon]) => (
                        <button
                            key={value}
                            title={hints[value]}
                            aria-pressed={active && mode === value}
                            onClick={() => {
                                onTool();
                                if (mode !== value) store.configureBuild({ mode: value });
                            }}
                        >
                            <Icon size={16} aria-hidden="true" />
                            {label}
                        </button>
                    ))}
                </div>
                {active && (
                    <div className="build-options" key={mode}>
                        {mode === 'floor' && (
                            <BuildMaterialPicker
                                {...history}
                                type="floor"
                                value={settings.floor}
                                surfaces={surfaces}
                                onChange={(floor) => store.configureBuild({ floor })}
                            />
                        )}
                        {placing && (
                            <>
                                <BuildMaterialPicker
                                    {...history}
                                    type={mode}
                                    value={settings[mode] ?? null}
                                    surfaces={surfaces}
                                    onChange={(value) => store.configureBuild({ [mode]: value })}
                                />
                            </>
                        )}
                        {drawing && (
                            <>
                                <BuildMaterialPicker
                                    {...history}
                                    type="wall"
                                    value={settings.wall}
                                    surfaces={surfaces}
                                    onChange={(wall) => store.configureBuild({ wall })}
                                />
                                {['rectangle', 'contour', 'circle', 'ellipse'].includes(mode) && (
                                    <BuildMaterialPicker
                                        {...history}
                                        type="floor"
                                        value={settings.floor}
                                        surfaces={surfaces}
                                        onChange={(floor) => store.configureBuild({ floor })}
                                    />
                                )}
                            </>
                        )}
                        {!placing && mode !== 'floor' && (
                            <button
                                className="build-grid-toggle"
                                aria-pressed={settings.gridSnap}
                                title="Привязка к узлам сетки"
                                onClick={() =>
                                    store.configureBuild({ gridSnap: !settings.gridSnap })
                                }
                            >
                                <Grid2X2 size={14} /> Сетка
                            </button>
                        )}
                        {(drawing || placing) && (
                            <EditorOptions
                                label={placing ? 'Ширина проёма' : 'Толщина стены'}
                                summary={`${placing ? settings.openingWidth : settings.thickness} wu`}
                            >
                                {placing ? (
                                    <NumberField
                                        label="Ширина проёма, wu"
                                        min={8}
                                        max={512}
                                        value={settings.openingWidth}
                                        onChange={(value) =>
                                            store.configureBuild({
                                                openingWidth: limit(value, 8, 512),
                                            })
                                        }
                                    />
                                ) : (
                                    <NumberField
                                        label="Толщина, wu"
                                        min={2}
                                        max={80}
                                        value={settings.thickness}
                                        onChange={(value) =>
                                            store.configureBuild({ thickness: limit(value, 2, 80) })
                                        }
                                    />
                                )}
                            </EditorOptions>
                        )}
                    </div>
                )}
                <p className="build-hint">
                    {!!state.openingPlacements?.length && (
                        <span role="status" aria-live="polite">
                            Последние проёмы: в очереди{' '}
                            {state.openingPlacements.filter((p) => p.status === 'pending').length}
                            {' · '}сохранено{' '}
                            {state.openingPlacements.filter((p) => p.status === 'confirmed').length}
                            {' · '}отклонено{' '}
                            {state.openingPlacements.filter((p) => p.status === 'rejected').length}
                        </span>
                    )}
                    {active ? hints[mode] : 'Выберите инструмент, чтобы продолжить'}
                    {active && mode === 'edit' && (
                        <span>
                            Маркеры — перенос · <kbd>Shift</kbd> при переносе — 45° · Shift + клик —
                            выбор · <kbd>Alt</kbd> без привязки
                        </span>
                    )}
                    {active && drawing && (
                        <span>
                            {!['rectangle', 'circle', 'ellipse'].includes(mode) && (
                                <>
                                    <kbd>Shift</kbd> шаг {mode === 'arc' ? '15°' : '45°'} ·{' '}
                                </>
                            )}
                            <kbd>Alt</kbd> без привязки · <kbd>Esc</kbd> отмена
                        </span>
                    )}
                </p>
            </div>
            {showInspector &&
                !state.roomProposal &&
                (walls.length > 0 || room || selectedVertex || opening) && (
                    <aside className="build-inspector panel" aria-label="Inspector Build">
                        <div className="panel-heading">
                            <strong>
                                {room
                                    ? 'Комната'
                                    : walls.length === 1
                                      ? 'Стена'
                                      : walls.length > 1
                                        ? `Стены · ${walls.length}`
                                        : selectedVertex
                                          ? 'Вершина'
                                          : opening && (opening.type === 'door' ? 'Дверь' : 'Окно')}
                            </strong>
                            <button
                                className="icon-button"
                                aria-label="Снять выбор"
                                onClick={() => store.selectStructure(undefined)}
                            >
                                <X size={15} />
                            </button>
                        </div>
                        <div className="build-inspector-body">
                            {selectedCurve && (
                                <CurveInspector
                                    key={JSON.stringify(selectedCurve)}
                                    store={store}
                                    curve={selectedCurve}
                                    open={!!openCurve}
                                />
                            )}
                            {sourceAssembly && sourceIndex !== undefined && (
                                <RoomSourceInspector
                                    key={
                                        sourceAssembly.id +
                                        ':' +
                                        sourceIndex +
                                        ':' +
                                        graph.vertices.map((v) => `${v.x},${v.y}`).join(';')
                                    }
                                    store={store}
                                    assemblyId={sourceAssembly.id}
                                    sourceIndex={sourceIndex}
                                    history={history}
                                />
                            )}
                            {opening && (
                                <>
                                    <BuildMaterialPicker
                                        {...history}
                                        type={opening.type}
                                        value={opening.materialVersionId ?? null}
                                        surfaces={surfaces}
                                        onChange={(materialVersionId) =>
                                            store.saveStructure(
                                                putOpening(graph, {
                                                    ...opening,
                                                    materialVersionId,
                                                }),
                                            )
                                        }
                                    />
                                    <OpeningInspector
                                        key={opening.id}
                                        opening={opening}
                                        store={store}
                                        save={(value) =>
                                            store.saveStructure(putOpening(graph, value))
                                        }
                                    />
                                </>
                            )}
                            {(walls.length > 0 || selectedVertex) && (
                                <MoveSelection
                                    key={
                                        (selection?.kind === 'edges'
                                            ? selection.ids.join(':')
                                            : selection?.id) +
                                        ':' +
                                        graph.vertices.map((v) => `${v.x},${v.y}`).join(';')
                                    }
                                    anchors={selectionAnchors(graph, selection)}
                                    onMove={(delta) => store.onStructureMove?.(delta)}
                                />
                            )}
                            {walls.length > 0 && (
                                <SurfaceInspector
                                    {...history}
                                    key={surfaceKey(walls)}
                                    type="wall"
                                    objects={walls}
                                    surfaces={surfaces}
                                    save={(patch) => {
                                        const ids = new Set(walls.map((wall) => wall.id));
                                        store.saveStructure({
                                            ...graph,
                                            edges: graph.edges.map((edge) =>
                                                ids.has(edge.id) ? { ...edge, ...patch } : edge,
                                            ),
                                        });
                                    }}
                                />
                            )}
                            {room && !sourceAssembly && (
                                <SurfaceInspector
                                    {...history}
                                    key={surfaceKey([room])}
                                    type="floor"
                                    objects={[room]}
                                    surfaces={surfaces}
                                    save={(patch) =>
                                        store.saveStructure({
                                            ...graph,
                                            rooms: graph.rooms.map((row) =>
                                                row.id === room.id ? { ...row, ...patch } : row,
                                            ),
                                        })
                                    }
                                />
                            )}
                            {!opening && (
                                <div className="build-selection-actions">
                                    {canJoin && (
                                        <button onClick={() => action?.('join')}>
                                            Соединить стены
                                        </button>
                                    )}
                                    <button onClick={() => action?.('delete')}>
                                        {room ? 'Удалить комнату, оставить стены' : 'Удалить'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </aside>
                )}
        </>
    );
}

function MoveSelection({
    onMove,
    anchors,
}: {
    onMove: (delta: { x: number; y: number }) => void;
    anchors: BuildAnchor[];
}) {
    const [absolute, setAbsolute] = useState(false);
    const [anchorIndex, setAnchorIndex] = useState(0);
    const anchor = anchors[anchorIndex]?.point ?? { x: 0, y: 0 };
    return (
        <details className="build-move">
            <summary>Переместить</summary>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    onMove({
                        x: Number(data.get('x')) - (absolute ? anchor.x : 0),
                        y: Number(data.get('y')) - (absolute ? anchor.y : 0),
                    });
                }}
            >
                <label className="field build-move-mode">
                    <span>Позиционирование</span>
                    <select
                        value={absolute ? 'absolute' : 'delta'}
                        onChange={(e) => setAbsolute(e.target.value === 'absolute')}
                    >
                        <option value="delta">Смещение</option>
                        <option value="absolute">Координаты точки захвата</option>
                    </select>
                </label>
                {absolute && (
                    <label className="field build-move-mode">
                        <span>Точка захвата</span>
                        <select
                            value={anchorIndex}
                            onChange={(e) => setAnchorIndex(Number(e.target.value))}
                        >
                            {anchors.map((h, i) => (
                                <option key={i} value={i}>
                                    {h.label.replace('Перенести за ', '')} · {h.point.x.toFixed(1)},{' '}
                                    {h.point.y.toFixed(1)}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <label className="field">
                    <span>{absolute ? 'X, wu' : 'Δ X, wu'}</span>
                    <input
                        key={`x:${absolute}:${anchorIndex}`}
                        type="number"
                        name="x"
                        required
                        defaultValue={absolute ? anchor.x : 0}
                        step="0.001"
                    />
                </label>
                <label className="field">
                    <span>{absolute ? 'Y, wu' : 'Δ Y, wu'}</span>
                    <input
                        key={`y:${absolute}:${anchorIndex}`}
                        type="number"
                        name="y"
                        required
                        defaultValue={absolute ? anchor.y : 0}
                        step="0.001"
                    />
                </label>
                <button className="primary-button" type="submit">
                    {absolute ? 'Поставить точно' : 'Сместить'}
                </button>
            </form>
        </details>
    );
}

function SurfaceInspector({
    type,
    objects,
    surfaces,
    save,
    ...history
}: {
    type: 'wall' | 'floor';
    objects: (Wall | Room)[];
    surfaces?: Surface[];
    save: (patch: Partial<Pick<Wall, 'thickness' | 'materialVersionId'>>) => void;
} & BuildMaterialHistory) {
    const sharedMaterial = objects.every(
        (object) => object.materialVersionId === objects[0].materialVersionId,
    )
        ? objects[0].materialVersionId
        : undefined;
    const walls = objects.filter((object): object is Wall => 'thickness' in object);
    const sharedThickness = walls.every((wall) => wall.thickness === walls[0]?.thickness)
        ? walls[0]?.thickness
        : undefined;
    const [material, setMaterial] = useState(sharedMaterial);
    const [thickness, setThickness] = useState(sharedThickness?.toString() ?? '');
    const thicknessChanged = thickness !== '' && Number(thickness) !== sharedThickness;
    const materialChanged = material !== undefined && material !== sharedMaterial;
    return (
        <form
            className="build-selection"
            onSubmit={(event) => {
                event.preventDefault();
                save({
                    ...(materialChanged && { materialVersionId: material }),
                    ...(thicknessChanged && { thickness: Number(thickness) }),
                });
            }}
        >
            {type === 'wall' && (
                <label className="field">
                    <span>Толщина, wu</span>
                    <input
                        type="number"
                        min={2}
                        max={80}
                        step={0.001}
                        value={thickness}
                        placeholder="Разная"
                        onChange={(event) => setThickness(event.target.value)}
                    />
                </label>
            )}
            <BuildMaterialPicker
                {...history}
                type={type}
                value={material}
                surfaces={surfaces}
                onChange={setMaterial}
            />
            <button
                className="primary-button"
                type="submit"
                disabled={!materialChanged && !thicknessChanged}
            >
                {type === 'floor'
                    ? 'Применить пол'
                    : objects.length === 1
                      ? 'Применить стену'
                      : 'Применить к стенам'}
            </button>
        </form>
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
                            onChange={(e) => {
                                const hinge = e.target.value === 'a' ? 'a' : 'b';
                                save({ ...opening, hinge } as const);
                            }}
                        >
                            <option value="a">Начало ребра</option>
                            <option value="b">Конец ребра</option>
                        </select>
                    </label>
                    <label className="build-field">
                        Сторона открывания
                        <select
                            value={opening.direction}
                            onChange={(e) => {
                                const direction = e.target.value === 'left' ? 'left' : 'right';
                                save({ ...opening, direction } as const);
                            }}
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
                    <small>Окно всегда блокирует движение. Закрытая створка перекрывает обзор и свет.</small>
                </>
            )}
            <button onClick={() => store.onStructureAction?.('delete')}>Удалить проём</button>
        </div>
    );
}
