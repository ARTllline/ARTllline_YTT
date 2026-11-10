import { useEffect, useState } from 'react';
import { Copy, Palette, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { AssetPicker } from '../../control/AssetLibrary';
import { Dialog } from '../Dialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { NumberField } from '../NumberField';
import { usePanelGuard } from '../ui/PanelGuard';
import type { ImageAsset } from '../../tabletop/types/scene';
import { materials, materialTypes, repeatPixels, type Material } from './materials';

export function MaterialPreview({
    material,
    large = false,
}: {
    material: Pick<Material, 'asset' | 'repeatSize' | 'rotation'> &
        Partial<Pick<Material, 'type' | 'layout'>>;
    large?: boolean;
}) {
    const size = repeatPixels(material, large ? 0.45 : 0.2);
    const [texture, setTexture] = useState<{ url: string; status: 'ready' | 'error' }>();
    useEffect(() => {
        let active = true;
        const img = new window.Image();
        img.onload = () => {
            if (active) setTexture({ url: material.asset.url, status: 'ready' });
        };
        img.onerror = () => {
            if (active) setTexture({ url: material.asset.url, status: 'error' });
        };
        img.src = material.asset.url;
        return () => {
            active = false;
        };
    }, [material.asset.url]);
    const status = texture?.url === material.asset.url ? texture.status : 'loading';
    const object = material.type === 'door' || material.type === 'window';
    const rotation = material.layout === 'wall-strip' ? 0 : material.rotation;
    return (
        <div
            className={`material-preview ${large ? 'large' : ''}`}
            aria-label={object ? 'Превью стиля проёма' : 'Превью повторяемой текстуры'}
        >
            <div
                style={{
                    backgroundImage: `url(${JSON.stringify(material.asset.url)})`,
                    ...(object
                        ? {
                              inset: 6,
                              backgroundRepeat: 'no-repeat',
                              backgroundPosition: 'center',
                              backgroundSize: 'contain',
                          }
                        : {
                              backgroundSize: `${size.width}px ${size.height}px`,
                              transform: `rotate(${rotation}deg)`,
                          }),
                }}
            />
            {large && !object && (
                <span>
                    1 world unit = 0.45 px ·{' '}
                    {material.layout === 'wall-strip' ? 'вдоль стены' : `поворот ${rotation}°`}
                </span>
            )}
            {status !== 'ready' && (
                <span className="material-preview-status" role="status">
                    {status === 'error' ? 'Текстура недоступна' : 'Загружаем текстуру…'}
                </span>
            )}
        </div>
    );
}

export function MaterialLibrary({ onClose }: { onClose: () => void }) {
    const [search, setSearch] = useState(''),
        [type, setType] = useState('');
    const [page, setPage] = useState(1),
        [pages, setPages] = useState(1);
    const [items, setItems] = useState<Material[] | null>(null);
    const [revision, setRevision] = useState(0),
        [error, setError] = useState('');
    const [editing, setEditing] = useState<Material | 'new' | null>(null);
    const [deleting, setDeleting] = useState<Material | null>(null);
    const [busy, setBusy] = useState(false);
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
    }, [search, type, page, revision]);
    const duplicate = async (m: Material) => {
        setBusy(true);
        setError('');
        try {
            const copy = await materials.duplicate(m.id);
            setRevision((v) => v + 1);
            if (m.builtin) setEditing(copy);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <aside className="map-editor-panel material-library panel" aria-label="Материалы">
            <div className="panel-heading">
                <Palette size={16} />
                <strong>Материалы</strong>
                <button className="icon-button" aria-label="Закрыть материалы" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>
            <div className="map-editor-panel-body">
                <button className="secondary-button" onClick={() => setEditing('new')}>
                    <Plus size={15} /> Создать материал
                </button>
                <div className="map-editor-filters">
                    <div className="map-editor-search">
                        <Search size={15} />
                        <input
                            type="search"
                            aria-label="Поиск материалов"
                            placeholder="Поиск материалов…"
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                                setItems(null);
                            }}
                        />
                    </div>
                    <select
                        aria-label="Тип материала"
                        value={type}
                        onChange={(e) => {
                            setType(e.target.value);
                            setPage(1);
                            setItems(null);
                        }}
                    >
                        <option value="">Все типы</option>
                        {Object.entries(materialTypes).map(([k, label]) => (
                            <option key={k} value={k}>
                                {label}
                            </option>
                        ))}
                    </select>
                </div>
                {error && (
                    <p role="alert">
                        {error}{' '}
                        <button className="text-button" onClick={() => setRevision((v) => v + 1)}>
                            <RefreshCw size={12} /> Обновить
                        </button>
                    </p>
                )}
                {!items && !error && <p role="status">Загружаем материалы…</p>}
                {items?.length === 0 && (
                    <p className="hint">
                        Создайте материал из текстуры в Global Assets. Библиотека доступна во всех
                        ваших кампаниях.
                    </p>
                )}
                <div className="material-cards map-editor-results" aria-busy={!items && !error}>
                    {items?.map((m) => {
                        const Card = m.builtin ? 'div' : 'button';
                        return (
                            <article key={m.id} className="material-card">
                                <Card
                                    className="material-card-open"
                                    {...(!m.builtin && {
                                        onClick: () => setEditing(m),
                                        disabled: busy,
                                        'aria-label': `Редактировать материал ${m.name}`,
                                    })}
                                >
                                    <MaterialPreview material={m} />
                                    <strong title={m.name}>{m.displayName ?? m.name}</strong>
                                    <small>
                                        {materialTypes[m.type]} · v{m.version}
                                        {m.builtin && ' · Встроенный'}
                                    </small>
                                    {m.type !== 'door' && m.type !== 'window' && (
                                        <small>{m.repeatSize} wu / повтор</small>
                                    )}
                                </Card>
                                <div className="material-card-actions">
                                    <button
                                        title="Редактировать материал"
                                        disabled={busy || m.builtin}
                                        onClick={() => setEditing(m)}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        title="Дублировать материал"
                                        disabled={busy}
                                        onClick={() => void duplicate(m)}
                                    >
                                        <Copy size={14} />
                                    </button>
                                    <button
                                        title="Удалить материал"
                                        disabled={busy || m.builtin}
                                        onClick={() => setDeleting(m)}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
                {pages > 1 && (
                    <div className="map-editor-pagination">
                        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                            Назад
                        </button>
                        <span>
                            {page} / {pages}
                        </span>
                        <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
                            Далее
                        </button>
                    </div>
                )}
            </div>
            {editing && (
                <MaterialForm
                    key={editing === 'new' ? 'new' : editing.versionId}
                    material={editing === 'new' ? undefined : editing}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        setRevision((v) => v + 1);
                    }}
                />
            )}
            {deleting && (
                <ConfirmDialog
                    title="Удалить материал?"
                    description="Версии используемых материалов защищены. Текстура останется в Assets."
                    onClose={() => setDeleting(null)}
                    submit={async () => {
                        await materials.remove(deleting.id);
                        setRevision((v) => v + 1);
                    }}
                />
            )}
        </aside>
    );
}

function MaterialForm({
    material,
    onClose,
    onSaved,
}: {
    material?: Material;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [name, setName] = useState(material?.name ?? '');
    const [type, setType] = useState<Material['type']>(material?.type ?? 'terrain');
    const [asset, setAsset] = useState<ImageAsset | null>(material?.asset ?? null);
    const [repeatSize, setRepeatSize] = useState(material?.repeatSize ?? 120);
    const [rotation, setRotation] = useState(material?.rotation ?? 0);
    const [layout, setLayout] = useState<Material['layout']>(material?.layout);
    const surface = type !== 'door' && type !== 'window';
    const wallStrip = type === 'wall' && layout === 'wall-strip';
    const [variation, setVariation] = useState(
        material?.variation ?? { offset: false, quarterTurns: false },
    );
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const [discard, setDiscard] = useState(false);
    const dirty =
        JSON.stringify({
            name,
            type,
            assetId: asset?.id,
            repeatSize,
            rotation,
            variation,
            layout,
        }) !==
        JSON.stringify({
            name: material?.name ?? '',
            type: material?.type ?? 'terrain',
            assetId: material?.asset.id,
            repeatSize: material?.repeatSize ?? 120,
            rotation: material?.rotation ?? 0,
            variation: material?.variation ?? { offset: false, quarterTurns: false },
            layout: material?.layout,
        });
    usePanelGuard(
        busy
            ? 'Дождитесь сохранения материала.'
            : dirty
              ? 'Сохраните материал или закройте его форму, отменив изменения.'
              : '',
    );
    const close = () => {
        if (!busy) {
            if (dirty) setDiscard(true);
            else onClose();
        }
    };
    return (
        <Dialog title={material ? 'Редактировать материал' : 'Новый материал'} onClose={close}>
            <form
                className="material-form"
                onSubmit={(e) => {
                    e.preventDefault();
                    if (!asset || busy) return;
                    setBusy(true);
                    setError('');
                    void materials
                        .save(
                            {
                                name,
                                type,
                                asset,
                                repeatSize,
                                rotation,
                                layout,
                                variation,
                                version: material?.version ?? 1,
                            },
                            material?.id,
                        )
                        .then(onSaved)
                        .catch((e: Error) => setError(e.message))
                        .finally(() => setBusy(false));
                }}
            >
                <fieldset disabled={busy}>
                    {asset && (
                        <MaterialPreview
                            material={{ asset, repeatSize, rotation, type, layout }}
                            large
                        />
                    )}
                    <label className="field">
                        Название
                        <input
                            required
                            maxLength={120}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </label>
                    <label className="field">
                        Назначение
                        <select
                            value={type}
                            onChange={(e) => setType(e.target.value as Material['type'])}
                        >
                            {Object.entries(materialTypes).map(([k, label]) => (
                                <option key={k} value={k}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </label>
                    <AssetPicker
                        value={asset}
                        label="Текстура из Global Assets"
                        onChange={setAsset}
                        personalOnly
                    />
                    {type === 'wall' && (
                        <label className="check-field">
                            <input
                                type="checkbox"
                                checked={layout === 'wall-strip'}
                                onChange={(e) => setLayout(e.target.checked ? 'wall-strip' : null)}
                            />
                            Укладывать вдоль стены
                        </label>
                    )}
                    {type === 'door' && (
                        <>
                            <label className="check-field">
                                <input
                                    type="checkbox"
                                    checked={layout === 'gate-atlas'}
                                    onChange={(e) =>
                                        setLayout(e.target.checked ? 'gate-atlas' : 'door-atlas')
                                    }
                                />
                                Подъёмная решётка
                            </label>
                            <p className="hint">
                                Атлас с двумя равными строками. Сверху закрытая дверь, снизу
                                открытый проём.
                            </p>
                        </>
                    )}
                    {surface && (
                        <div className="field-grid">
                            <NumberField
                                label="Ширина повтора, world units"
                                value={repeatSize}
                                min={1}
                                max={20000}
                                onChange={setRepeatSize}
                            />
                            {!wallStrip && (
                                <NumberField
                                    label="Базовый поворот, °"
                                    value={rotation}
                                    min={0}
                                    max={360}
                                    onChange={setRotation}
                                />
                            )}
                        </div>
                    )}
                    {surface && !wallStrip && (
                        <details>
                            <summary>Вариации для будущих размещений</summary>
                            <p className="hint">
                                Сохраняются в определении. Превью выше показывает базовый повтор.
                            </p>
                            <label className="check-field">
                                <input
                                    type="checkbox"
                                    checked={variation.offset}
                                    onChange={(e) =>
                                        setVariation({ ...variation, offset: e.target.checked })
                                    }
                                />{' '}
                                Варьировать начало текстуры
                            </label>
                            <label className="check-field">
                                <input
                                    type="checkbox"
                                    checked={variation.quarterTurns}
                                    onChange={(e) =>
                                        setVariation({
                                            ...variation,
                                            quarterTurns: e.target.checked,
                                        })
                                    }
                                />{' '}
                                Повороты с шагом 90°
                            </label>
                        </details>
                    )}
                    <p className="hint">
                        Правки создают новую версию. Будущие размещения сохраняют свою версию и
                        текстуру.
                    </p>
                    {error && <p role="alert">{error}</p>}
                    <button
                        type="submit"
                        className="primary-button"
                        disabled={!asset || !name.trim()}
                    >
                        {busy ? 'Сохраняем…' : 'Сохранить материал'}
                    </button>
                    {discard && (
                        <div className="material-discard">
                            <p>Отменить изменения материала?</p>
                            <button type="button" className="text-button" onClick={onClose}>
                                Отменить изменения
                            </button>
                            <button
                                type="button"
                                className="text-button"
                                onClick={() => setDiscard(false)}
                            >
                                Продолжить
                            </button>
                        </div>
                    )}
                </fieldset>
            </form>
        </Dialog>
    );
}
