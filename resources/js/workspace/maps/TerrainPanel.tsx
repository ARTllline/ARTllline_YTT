import { defaultTerrainBrush } from '../../tabletop/mapEditor';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Eraser, Paintbrush, RefreshCw } from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import { MaterialPreview } from './MaterialLibrary';
import { materials, type Material } from './materials';

export function TerrainPanel({
    store,
    onTool,
    onMaterials,
    onSettings,
}: {
    store: SceneStore;
    onTool: () => void;
    onMaterials: () => void;
    onSettings: () => void;
}) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const settings = state.mapEditor?.terrain ?? defaultTerrainBrush;
    const [items, setItems] = useState<Material[]>();
    const [error, setError] = useState(''),
        [refresh, setRefresh] = useState(0);
    const [search, setSearch] = useState(''),
        [page, setPage] = useState(1),
        [pages, setPages] = useState(1);
    const [type, setType] = useState<'terrain' | 'floor'>('terrain');
    const update = (patch: Partial<typeof settings>) => {
        if (state.mapEditor)
            store.setMapEditor({ ...state.mapEditor, terrain: { ...settings, ...patch } });
        onTool();
    };
    useEffect(() => {
        const abort = new AbortController();
        void materials
            .list(search, type, page, abort.signal)
            .then((r) => {
                setItems(r.materials);
                setPages(r.pages);
                setError('');
            })
            .catch((e: Error) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [search, page, refresh, type]);
    return (
        <aside className="map-editor-panel panel terrain-panel" aria-label="Terrain Painter">
            <div className="panel-heading">
                <span>Terrain · поверхности</span>
                <Paintbrush size={16} />
            </div>
            <div className="map-editor-panel-body">
                {!state.scene.mapWorld ? (
                    <>
                        <p>Создайте редактируемую основу, чтобы рисовать покрытия.</p>
                        <button className="primary-button" onClick={onSettings}>
                            Создать MapWorld
                        </button>
                    </>
                ) : (
                    <>
                        <div className="terrain-tools">
                            <button
                                aria-pressed={settings.operation === 'paint'}
                                onClick={() => update({ operation: 'paint' })}
                            >
                                <Paintbrush size={16} /> Paint
                            </button>
                            <button
                                aria-pressed={settings.operation === 'erase'}
                                onClick={() => update({ operation: 'erase' })}
                            >
                                <Eraser size={16} /> Erase
                            </button>
                        </div>
                        {(
                            [
                                ['size', 'Размер кисти', 4, 1024],
                                ['softness', 'Мягкость', 0, 255],
                                ['strength', 'Непрозрачность', 1, 255],
                            ] as const
                        ).map(([key, label, min, max]) => (
                            <label className="terrain-slider" key={key}>
                                <span>
                                    {label}
                                    <output>
                                        {key === 'size'
                                            ? `${settings[key]} wu`
                                            : `${Math.round((settings[key] / 255) * 100)}%`}
                                    </output>
                                </span>
                                <input
                                    aria-label={label}
                                    type="range"
                                    min={min}
                                    max={max}
                                    value={settings[key]}
                                    onChange={(e) => update({ [key]: Number(e.target.value) })}
                                />
                            </label>
                        ))}
                        <p className="hint">
                            {settings.operation === 'erase'
                                ? 'Стирание всех покрытий'
                                : (settings.material?.name ?? 'Выберите материал ниже')}{' '}
                            · удерживайте мышь
                            <br />
                            [ / ] — size · E — Paint / Erase
                            <br />
                            Space + drag — панорама · Esc — отменить мазок
                        </p>
                        <select
                            aria-label="Surface type"
                            value={type}
                            onChange={(e) => {
                                setType(e.target.value === 'floor' ? 'floor' : 'terrain');
                                setPage(1);
                            }}
                        >
                            <option value="terrain">Terrain</option>
                            <option value="floor">Floor</option>
                        </select>
                        <input
                            aria-label="Поиск материала кисти"
                            placeholder="Материал поверхности…"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                        />
                        {error && (
                            <p role="alert">
                                {error}{' '}
                                <button onClick={() => setRefresh((v) => v + 1)}>
                                    <RefreshCw size={14} /> Повторить
                                </button>
                            </p>
                        )}
                        {!items && !error && <p role="status">Загружаем материалы…</p>}
                        <div className="terrain-materials">
                            {items?.map((m) => (
                                <button
                                    key={m.versionId}
                                    className="terrain-material"
                                    aria-label={`Рисовать: ${m.name}`}
                                    aria-pressed={settings.material?.versionId === m.versionId}
                                    onClick={() => update({ material: m, operation: 'paint' })}
                                >
                                    <MaterialPreview material={m} />
                                    <strong>{m.name}</strong>
                                    <small>
                                        v{m.version} · {m.repeatSize} wu
                                    </small>
                                </button>
                            ))}
                        </div>
                        {items?.length === 0 && (
                            <p className="hint">Создайте материал из текстуры в библиотеке.</p>
                        )}
                        {pages > 1 && (
                            <div className="map-editor-pagination">
                                <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                                    Назад
                                </button>
                                <span>
                                    {page} / {pages}
                                </span>
                                <button disabled={page === pages} onClick={() => setPage(page + 1)}>
                                    Далее
                                </button>
                            </div>
                        )}
                        <button className="text-button" onClick={onMaterials}>
                            Открыть библиотеку материалов
                        </button>
                    </>
                )}
            </div>
        </aside>
    );
}
