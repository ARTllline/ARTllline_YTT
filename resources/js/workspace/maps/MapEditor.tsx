import { useEffect, useState, useSyncExternalStore } from 'react';
import {
    Check,
    CloudFog,
    Flame,
    LoaderCircle,
    TriangleAlert,
    Box,
    BrickWall,
    Paintbrush,
    Eye,
    EyeOff,
    Hand,
    Image,
    Layers,
    Lock,
    Maximize,
    MousePointer2,
    Palette,
    Settings2,
    Unlock,
    X,
} from 'lucide-react';
import { AssetPicker } from '../../control/AssetLibrary';
import type { LibraryAsset } from '../../api/preparation';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import { initialEditorView, readTerrainBrush, terrainBrushStorage } from '../../tabletop/mapEditor';
import { PropInspector } from '../objects/PropInspector';
import { HistoryControls } from '../HistoryControls';
import { FogControls, FogPanel } from '../FogControls';
import { MapPreparation } from './MapPreparation';
import { LightingPanel } from './LightingPanel';
import { LosDebugPanel } from './LosDebugPanel';
import { MaterialLibrary } from './MaterialLibrary';
import { BuildPanel } from './BuildPanel';
import { useBuildMaterialHistory } from './BuildMaterialPicker';
import { TerrainPanel } from './TerrainPanel';
import { ObjectPresetLibrary } from './ObjectPresetLibrary';
import type { ObjectPreset } from '../../tabletop/objects/collider';
import '../../../css/map-editor.css';

const workModes = [
    ['terrain', 'Terrain', Paintbrush],
    ['build', 'Build', BrickWall],
    ['objects', 'Objects', Box],
    ['lighting', 'Свет', Flame],
    ['fog', 'Туман', CloudFog],
] as const;

type WorkMode = (typeof workModes)[number][0];
type MapPanel = WorkMode | 'materials' | 'layers' | 'settings' | 'los';
const isWorkMode = (panel: MapPanel): panel is WorkMode =>
    workModes.some(([mode]) => mode === panel);

export function MapEditor({
    store,
    queue,
    active,
    onFit,
    onTool,
    onPlace,
    onPlacePreset,
    onCancelPlacement,
    placing,
    guard,
}: {
    store: SceneStore;
    queue: SaveQueue;
    active: boolean;
    onFit: () => void;
    onTool: (tool: 'select' | 'pan' | 'terrain' | 'build' | 'fog') => void;
    onPlace: (asset: LibraryAsset) => void;
    onPlacePreset: (preset: ObjectPreset) => void;
    onCancelPlacement: () => void;
    placing: boolean;
    guard: { current: string };
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const tool = useSyncExternalStore(store.spatial.subscribe, store.spatial.getTool);
    const [panel, setPanel] = useState<MapPanel>('objects');
    const [workMode, setWorkMode] = useState<WorkMode>('objects');
    const history = useBuildMaterialHistory();
    const [notice, setNotice] = useState('');
    const [los, setLos] = useState(false);
    const view = state.mapEditor ?? initialEditorView;
    useEffect(() => {
        store.setMapEditor({ ...initialEditorView, terrain: readTerrainBrush() });
        return () => {
            store.spatial.setTool('select');
            store.setMapEditor(null);
        };
    }, [store]);
    const { size, softness, strength } = state.mapEditor?.terrain ?? {};
    useEffect(() => {
        if (size === undefined) return;
        try {
            localStorage.setItem(terrainBrushStorage, JSON.stringify({ size, softness, strength }));
        } catch {
            // Browser storage may be disabled.
        }
    }, [size, softness, strength]);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                !document.querySelector('dialog[open]') &&
                !(
                    e.target instanceof Element &&
                    e.target.closest('input, textarea, select, [contenteditable]')
                ) &&
                store.spatial.getTool() === 'terrain'
            ) {
                const editor = store.getSnapshot().mapEditor;
                const brush = editor?.terrain;
                if (editor && brush && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
                    const step = Math.max(2, Math.round(brush.size * 0.1));
                    const size = Math.min(
                        1024,
                        Math.max(4, brush.size + (e.code === 'BracketLeft' ? -step : step)),
                    );
                    store.setMapEditor({ ...editor, terrain: { ...brush, size } });
                    e.preventDefault();
                }
                if (editor && brush && e.code === 'KeyE' && !e.repeat) {
                    const operation = brush.operation === 'paint' ? 'erase' : 'paint';
                    store.setMapEditor({ ...editor, terrain: { ...brush, operation } });
                    e.preventDefault();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
                e.preventDefault();
                if (document.querySelector('dialog[open]')) return;
                if (guard.current) {
                    setNotice('Сохраните настройки кнопкой в открытой панели.');
                    return;
                }
                void queue.flush().catch((e: Error) => setNotice(e.message));
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [queue, guard, store]);
    const activate = (next: MapPanel) => {
        onCancelPlacement();
        const nextTool = next === 'terrain' || next === 'build' || next === 'fog' ? next : 'select';
        if (tool !== nextTool) onTool(nextTool);
        setNotice('');
        setPanel(next);
        if (isWorkMode(next)) setWorkMode(next);
        if (next === 'build' && panel === 'los') setLos(true);
        if (next !== 'build' && next !== 'los') setLos(false);
    };
    const choose = (next: MapPanel) => {
        if (guard.current) {
            if (next !== panel) setNotice(guard.current);
            return;
        }
        activate(next);
    };
    const toggleLos = () => {
        if (panel === 'build') {
            setLos(!los);
        } else {
            choose(panel === 'los' ? workMode : 'los');
        }
    };
    const showLos = panel === 'los' || (panel === 'build' && los);
    const prop = state.scene.props?.find((p) => p.id === state.selectedPropIds?.[0]);
    const rejected = state.openingPlacements?.some((p) => p.status === 'rejected');
    const StatusIcon =
        save.status === 'failed' || rejected
            ? TriangleAlert
            : save.status === 'saving'
              ? LoaderCircle
              : Check;
    return (
        <div className={'map-editor map-mode-' + panel} aria-label="Редактор карты">
            <div className="map-editor-command">
                <div
                    className="map-editor-toolbar surface"
                    aria-label="Инструменты редактора карты"
                >
                    <div
                        className="map-editor-mode-group"
                        role="group"
                        aria-label="Режимы редактора"
                    >
                        {workModes.map(([value, label, Icon]) => (
                            <button
                                key={value}
                                aria-pressed={panel === value}
                                onClick={() => choose(value)}
                            >
                                <Icon size={16} /> {label}
                            </button>
                        ))}
                    </div>
                    <div
                        className="map-editor-mode-group"
                        role="group"
                        aria-label="Карта и библиотеки"
                    >
                        <button
                            aria-pressed={panel === 'materials'}
                            onClick={() => choose(panel === 'materials' ? workMode : 'materials')}
                        >
                            <Palette size={16} /> Материалы
                        </button>
                        <button
                            aria-label="LOS debug"
                            title="Обзор игроков и проверка LOS"
                            aria-pressed={showLos}
                            onClick={toggleLos}
                        >
                            <Eye size={16} /> LOS
                        </button>
                        <button
                            title="Слои редактора"
                            aria-label="Слои редактора"
                            aria-pressed={panel === 'layers'}
                            onClick={() => choose(panel === 'layers' ? workMode : 'layers')}
                        >
                            <Layers size={16} /> Слои
                        </button>
                        <button
                            title="Настройки карты и сетки"
                            aria-label="Настройки карты и сетки"
                            aria-pressed={panel === 'settings'}
                            onClick={() => choose(panel === 'settings' ? workMode : 'settings')}
                        >
                            <Settings2 size={16} />
                        </button>
                    </div>
                    <div
                        className="map-editor-mode-group"
                        role="group"
                        aria-label="Камера и история"
                    >
                        <button
                            title="Выбор · V"
                            aria-label="Выбор объектов"
                            aria-pressed={tool === 'select' && !placing}
                            disabled={panel === 'settings'}
                            onClick={() => {
                                if (panel === 'los' || panel === 'lighting') {
                                    onCancelPlacement();
                                    onTool('select');
                                } else choose('objects');
                            }}
                        >
                            <MousePointer2 size={16} />
                        </button>
                        <button
                            title="Панорама · H / Space + drag"
                            aria-label="Панорама"
                            aria-pressed={tool === 'pan'}
                            onClick={() => {
                                onCancelPlacement();
                                if (tool !== 'pan') onTool('pan');
                            }}
                        >
                            <Hand size={16} />
                        </button>
                        <button
                            title="Показать карту целиком"
                            aria-label="Показать карту целиком"
                            onClick={onFit}
                        >
                            <Maximize size={16} />
                        </button>
                        <fieldset className="map-editor-history" disabled={panel === 'settings'}>
                            <HistoryControls store={store} />
                        </fieldset>
                    </div>
                </div>
                {panel === 'build' && (
                    <BuildPanel
                        store={store}
                        history={history}
                        showInspector={!showLos}
                        onTool={() => onTool('build')}
                        onSettings={() => choose('settings')}
                    />
                )}
                {panel === 'terrain' && (
                    <TerrainPanel
                        store={store}
                        onTool={() => {
                            if (tool !== 'terrain') onTool('terrain');
                        }}
                        onMaterials={() => choose('materials')}
                        onSettings={() => choose('settings')}
                    />
                )}
                {panel === 'fog' && (
                    <div className="map-editor-context surface" role="group" aria-label="Рисование тумана">
                        <FogControls store={store} active={tool === 'fog'} onActivate={() => onTool('fog')} />
                    </div>
                )}
                {panel === 'objects' && (
                    <div
                        className="map-editor-context surface"
                        role="group"
                        aria-label="Добавить объект"
                    >
                        <ObjectPresetLibrary
                            onPlace={(preset) => {
                                if (!view.objectsVisible || view.objectsLocked)
                                    setNotice('Включите и разблокируйте Objects в слоях.');
                                else onPlacePreset(preset);
                            }}
                        />
                        <AssetPicker
                            category="props"
                            label="Из Assets"
                            onChange={(asset) => {
                                if (!view.objectsVisible || view.objectsLocked)
                                    setNotice('Включите и разблокируйте Objects в слоях.');
                                else onPlace(asset);
                            }}
                        />
                        <button
                            title="Показать коллайдеры объектов"
                            aria-pressed={!!view.collisionDebug}
                            onClick={() =>
                                store.setMapEditor({
                                    ...view,
                                    collisionDebug: !view.collisionDebug,
                                })
                            }
                        >
                            <Box size={15} /> Коллайдеры
                        </button>
                        {!state.scene.mapWorld && (
                            <button onClick={() => choose('settings')}>
                                <Image size={15} /> Создать основу
                            </button>
                        )}
                        {view.collisionDebug && (
                            <small className="collision-legend">
                                Мятный — движение · лиловый — обзор · янтарный — свет
                            </small>
                        )}
                        {(!view.objectsVisible || view.objectsLocked) && (
                            <small>Объекты скрыты или заблокированы в слоях</small>
                        )}
                        {view.objectsVisible &&
                            !view.objectsLocked &&
                            !view.collisionDebug &&
                            !placing && (
                                <small>
                                    Shift + клик — несколько · Ctrl+D — копия · Del — удалить
                                </small>
                            )}
                    </div>
                )}
            </div>
            <div className="map-editor-status surface">
                <span className={active ? 'map-editor-live' : ''}>
                    <i /> {active ? 'В эфире' : 'Подготовка'}
                </span>
                <span className={'save-' + save.status} role="status">
                    <StatusIcon size={14} />
                    {save.status === 'saved'
                        ? rejected
                            ? 'Есть отклонённые проёмы'
                            : 'Все изменения сохранены'
                        : save.status === 'failed'
                          ? `Ошибка сохранения · ${save.error}`
                          : 'Сохраняем…'}
                </span>
                {save.status === 'failed' && <button onClick={queue.retry}>Повторить</button>}
            </div>
            {(notice || state.editorNotice) && (
                <div className="map-editor-notice" role="alert">
                    {notice || state.editorNotice}
                    <button
                        aria-label="Скрыть подсказку"
                        onClick={() => {
                            setNotice('');
                            store.editorNotice('');
                        }}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}
            {panel === 'settings' && (
                <MapPreparation
                    store={store}
                    queue={queue}
                    active={active}
                    onClose={() => activate(workMode)}
                    onFit={onFit}
                />
            )}
            {panel === 'materials' && <MaterialLibrary onClose={() => choose(workMode)} />}
            {showLos && (
                <LosDebugPanel
                    store={store}
                    probing={tool === 'select' && !placing}
                    onClose={toggleLos}
                />
            )}
            {panel === 'lighting' && (
                <LightingPanel
                    store={store}
                    queue={queue}
                    guard={guard}
                    onClose={() => choose('objects')}
                />
            )}
            {panel === 'fog' && (
                <FogPanel store={store} queue={queue} editor active={tool === 'fog'} onClose={() => choose('objects')} />
            )}
            {panel === 'objects' && prop && !placing && (
                <div className="map-editor-prop">
                    <PropInspector
                        key={prop.id}
                        prop={prop}
                        store={store}
                        busy={save.status !== 'saved' || view.objectsLocked || !view.objectsVisible}
                        mapEditor
                        onClose={() => store.select(null)}
                    />
                </div>
            )}
            {panel === 'layers' && (
                <aside className="map-editor-panel panel" aria-label="Слои редактора">
                    <div className="panel-heading">
                        <Layers size={16} />
                        <strong>Слои редактора</strong>
                        <button
                            className="icon-button"
                            aria-label="Закрыть слои"
                            onClick={() => choose(workMode)}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="map-editor-panel-body">
                        <p className="hint">Эти переключатели действуют в вашем редакторе.</p>
                        <div className="map-editor-layer">
                            <Image size={16} />
                            <span>
                                Background<small>Основа и настройки карты</small>
                            </span>
                            <button
                                title="Видимость Background в редакторе"
                                aria-label="Видимость Background в редакторе"
                                aria-pressed={view.backgroundVisible}
                                onClick={() =>
                                    store.setMapEditor({
                                        ...view,
                                        backgroundVisible: !view.backgroundVisible,
                                    })
                                }
                            >
                                {view.backgroundVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                            <button
                                title="Редактировать основу в настройках"
                                onClick={() => choose('settings')}
                            >
                                <Settings2 size={16} />
                            </button>
                        </div>
                        <div className="map-editor-layer">
                            <Paintbrush size={16} />
                            <span>
                                Terrain
                                <small>
                                    {state.scene.terrain?.chunks.length ?? 0} участков покрытия
                                </small>
                            </span>
                            <button onClick={() => choose('terrain')}>Рисовать</button>
                        </div>
                        <div className="map-editor-layer">
                            <BrickWall size={16} />
                            <span>
                                Structures
                                <small>
                                    Стены: {state.scene.structure?.graph.edges.length ?? 0} ·
                                    Комнаты: {state.scene.structure?.graph.rooms.length ?? 0}
                                </small>
                            </span>
                            <button onClick={() => choose('build')}>Открыть Build</button>
                        </div>
                        <div className="map-editor-layer">
                            <Box size={16} />
                            <span>
                                Objects<small>{state.scene.props?.length ?? 0} объектов</small>
                            </span>
                            <button
                                aria-label="Видимость Objects в редакторе"
                                aria-pressed={view.objectsVisible}
                                onClick={() =>
                                    store.setMapEditor({
                                        ...view,
                                        objectsVisible: !view.objectsVisible,
                                    })
                                }
                            >
                                {view.objectsVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                            <button
                                aria-label="Блокировка Objects в редакторе"
                                aria-pressed={view.objectsLocked}
                                onClick={() =>
                                    store.setMapEditor({
                                        ...view,
                                        objectsLocked: !view.objectsLocked,
                                    })
                                }
                            >
                                {view.objectsLocked ? <Lock size={16} /> : <Unlock size={16} />}
                            </button>
                        </div>
                    </div>
                </aside>
            )}
        </div>
    );
}
