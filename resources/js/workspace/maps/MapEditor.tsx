import { useEffect, useState, useSyncExternalStore } from 'react';
import {
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
import { MapPreparation } from './MapPreparation';
import { MaterialLibrary } from './MaterialLibrary';
import { BuildPanel } from './BuildPanel';
import { TerrainPanel } from './TerrainPanel';
import { ObjectPresetLibrary } from './ObjectPresetLibrary';
import type { ObjectPreset } from '../../tabletop/objects/collider';
import '../../../css/map-editor.css';

export function MapEditor({
    store,
    queue,
    active,
    onClose,
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
    onClose: () => void;
    onFit: () => void;
    onTool: (tool: 'select' | 'pan' | 'terrain' | 'build') => void;
    onPlace: (asset: LibraryAsset) => void;
    onPlacePreset: (preset: ObjectPreset) => void;
    onCancelPlacement: () => void;
    placing: boolean;
    guard: { current: string };
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const save = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
    const tool = useSyncExternalStore(store.spatial.subscribe, store.spatial.getTool);
    const [panel, setPanel] = useState<
        'objects' | 'settings' | 'materials' | 'layers' | 'terrain' | 'build'
    >('objects');
    const [notice, setNotice] = useState('');
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
    const choose = (next: typeof panel) => {
        if (guard.current) {
            setNotice(guard.current);
            return;
        }
        onCancelPlacement();
        if (next !== 'objects') store.select(null);
        onTool(next === 'terrain' || next === 'build' ? next : 'select');
        setNotice('');
        setPanel(next);
    };
    const prop = state.scene.props?.find((p) => p.id === state.selectedPropIds?.[0]);
    return (
        <div className="map-editor" aria-label="Редактор карты">
            <div
                className="map-editor-toolbar surface"
                role="toolbar"
                aria-label="Инструменты редактора карты"
            >
                <span className="map-editor-title">
                    <Box size={17} /> Map Editor
                </span>
                <button
                    title="Выбор · V"
                    aria-label="Выбор объектов"
                    aria-pressed={tool === 'select' && !placing}
                    disabled={panel === 'settings'}
                    onClick={() => {
                        onCancelPlacement();
                        onTool('select');
                    }}
                >
                    <MousePointer2 size={17} />
                </button>
                <button
                    title="Панорама · H / Space + drag"
                    aria-label="Панорама"
                    aria-pressed={tool === 'pan'}
                    onClick={() => {
                        onCancelPlacement();
                        onTool('pan');
                    }}
                >
                    <Hand size={17} />
                </button>
                <i />
                <button aria-pressed={panel === 'objects'} onClick={() => choose('objects')}>
                    <Box size={16} /> Objects
                </button>
                <button aria-pressed={panel === 'terrain'} onClick={() => choose('terrain')}>
                    <Paintbrush size={16} /> Terrain
                </button>
                <button aria-pressed={panel === 'build'} onClick={() => choose('build')}>
                    <BrickWall size={16} /> Build
                </button>
                <button aria-pressed={panel === 'materials'} onClick={() => choose('materials')}>
                    <Palette size={16} /> Материалы
                </button>
                <button
                    title="Слои редактора"
                    aria-label="Слои редактора"
                    aria-pressed={panel === 'layers'}
                    onClick={() => choose('layers')}
                >
                    <Layers size={16} />
                </button>
                <button
                    title="MapWorld и Grid Calibration"
                    aria-label="Настройки карты и сетки"
                    aria-pressed={panel === 'settings'}
                    onClick={() => choose('settings')}
                >
                    <Settings2 size={16} />
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
                <button
                    title="Закрыть редактор"
                    aria-label="Закрыть редактор карты"
                    onClick={() => {
                        if (guard.current) {
                            setNotice(guard.current);
                            return;
                        }
                        onCancelPlacement();
                        onClose();
                    }}
                >
                    <X size={17} />
                </button>
            </div>
            <div className="map-editor-status" role="status">
                <span className={`save-${save.status}`}>
                    {save.status === 'saved'
                        ? 'Все изменения сохранены'
                        : save.status === 'failed'
                          ? `Ошибка: ${save.error}`
                          : 'Сохраняем…'}
                </span>
                <span>
                    {active
                        ? 'В ЭФИРЕ · сохранённые правки видны игрокам'
                        : 'Подготовка сцены · правки сохраняются сразу'}
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
                    onClose={() => {
                        setNotice('');
                        setPanel('objects');
                    }}
                    onFit={onFit}
                />
            )}
            {panel === 'materials' && <MaterialLibrary onClose={() => choose('objects')} />}
            {panel === 'build' && (
                <BuildPanel
                    store={store}
                    onTool={() => onTool('build')}
                    onSettings={() => choose('settings')}
                />
            )}
            {panel === 'terrain' && (
                <TerrainPanel
                    store={store}
                    onTool={() => onTool('terrain')}
                    onMaterials={() => choose('materials')}
                    onSettings={() => choose('settings')}
                />
            )}
            {panel === 'objects' && (
                <>
                    <div className="map-editor-object-add surface">
                        <ObjectPresetLibrary
                            onPlace={(preset) => {
                                if (!view.objectsVisible || view.objectsLocked)
                                    setNotice('Включите и разблокируйте Objects в слоях.');
                                else onPlacePreset(preset);
                            }}
                        />
                        <AssetPicker
                            category="props"
                            label="Добавить объект из Assets"
                            onChange={(asset) => {
                                if (!view.objectsVisible || view.objectsLocked)
                                    setNotice('Включите и разблокируйте Objects в слоях.');
                                else onPlace(asset);
                            }}
                        />
                        <small>V выбор · Shift несколько · Ctrl+D копия · Del удалить</small>
                        <label className="check-field">
                            <input
                                type="checkbox"
                                checked={!!view.collisionDebug}
                                onChange={(e) =>
                                    store.setMapEditor({
                                        ...view,
                                        collisionDebug: e.target.checked,
                                    })
                                }
                            />
                            Коллайдеры
                        </label>
                        {view.collisionDebug && (
                            <small className="collision-legend">
                                Мятный — движение · лиловый — обзор · янтарный — свет. Сочетания
                                имеют отдельные цвета.
                            </small>
                        )}
                        {(!view.objectsVisible || view.objectsLocked) && (
                            <p className="hint">
                                Включите и разблокируйте Objects в слоях, чтобы редактировать.
                            </p>
                        )}
                    </div>
                    {prop && !placing ? (
                        <div className="map-editor-prop">
                            <PropInspector
                                key={prop.id}
                                prop={prop}
                                store={store}
                                busy={
                                    save.status !== 'saved' ||
                                    view.objectsLocked ||
                                    !view.objectsVisible
                                }
                                mapEditor
                                onClose={() => store.select(null)}
                            />
                        </div>
                    ) : (
                        !placing && (
                            <aside className="map-editor-panel map-editor-welcome panel">
                                <div className="map-editor-panel-body">
                                    <span className="eyebrow">TERRAIN → BUILD → OBJECTS</span>
                                    <h2>Соберите место действия</h2>
                                    <p>
                                        Выберите объект на карте или добавьте изображение из Assets.
                                        Перетащите объект, измените размер за угол; точный поворот и
                                        масштаб доступны в Inspector.
                                    </p>
                                    <p className="hint">
                                        Рисуйте покрытия в Terrain, добавляйте стены в Build и
                                        размещайте объекты.
                                    </p>
                                    <button
                                        className="text-button"
                                        onClick={() => choose('materials')}
                                    >
                                        <Palette size={14} /> Открыть материалы
                                    </button>
                                    {!state.scene.mapWorld && (
                                        <button
                                            className="text-button"
                                            onClick={() => choose('settings')}
                                        >
                                            <Image size={14} /> Создать MapWorld / настроить основу
                                        </button>
                                    )}
                                </div>
                            </aside>
                        )
                    )}
                </>
            )}
            {panel === 'layers' && (
                <aside className="map-editor-panel panel" aria-label="Слои редактора">
                    <div className="panel-heading">Слои рабочего пространства</div>
                    <div className="map-editor-panel-body">
                        <p className="hint">
                            Видимость и замок действуют только в этом редакторе. Видимость игроков и
                            будущая collision не меняются.
                        </p>
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
