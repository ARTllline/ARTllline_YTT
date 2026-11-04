import { useEffect, useState } from 'react';
import { Copy, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
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
    material: Pick<Material, 'asset' | 'repeatSize' | 'rotation'>;
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
    return (
        <div
            className={`material-preview ${large ? 'large' : ''}`}
            aria-label="Превью повторяемой текстуры"
        >
            <div
                style={{
                    backgroundImage: `url(${JSON.stringify(material.asset.url)})`,
                    backgroundSize: `${size.width}px ${size.height}px`,
                    transform: `rotate(${material.rotation}deg)`,
                }}
            />
            {large && <span>1 world unit = 0.45 px · поворот {material.rotation}°</span>}
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
            await materials.duplicate(m.id);
            setRevision((v) => v + 1);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <aside className="map-editor-panel material-library panel" aria-label="Материалы">
            <div className="panel-heading">
                <span>Материалы · моя библиотека</span>
                <button className="icon-button" aria-label="Закрыть материалы" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>
            <div className="map-editor-panel-body">
                <p className="hint">
                    Повторяемые текстуры для Terrain. Правки создают новые версии материалов.
                </p>
                <button className="secondary-button" onClick={() => setEditing('new')}>
                    <Plus size={15} /> Создать материал
                </button>
                <input
                    aria-label="Поиск материалов"
                    placeholder="Поиск материалов…"
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                        setItems(null);
                    }}
                />
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
                <div className="material-cards">
                    {items?.map((m) => (
                        <article key={m.id} className="material-card">
                            <button
                                className="material-card-open"
                                onClick={() => setEditing(m)}
                                aria-label={`Редактировать материал ${m.name}`}
                            >
                                <MaterialPreview material={m} />
                                <strong>{m.name}</strong>
                                <small>
                                    {materialTypes[m.type]} · v{m.version}
                                </small>
                                <small>{m.repeatSize} wu / повтор</small>
                            </button>
                            <div className="material-card-actions">
                                <button
                                    title="Редактировать материал"
                                    disabled={busy}
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
                                    disabled={busy}
                                    onClick={() => setDeleting(m)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </article>
                    ))}
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
    const [variation, setVariation] = useState(
        material?.variation ?? { offset: false, quarterTurns: false },
    );
    const [busy, setBusy] = useState(false),
        [error, setError] = useState('');
    const [discard, setDiscard] = useState(false);
    const dirty =
        JSON.stringify({ name, type, assetId: asset?.id, repeatSize, rotation, variation }) !==
        JSON.stringify({
            name: material?.name ?? '',
            type: material?.type ?? 'terrain',
            assetId: material?.asset.id,
            repeatSize: material?.repeatSize ?? 120,
            rotation: material?.rotation ?? 0,
            variation: material?.variation ?? { offset: false, quarterTurns: false },
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
                    {asset && <MaterialPreview material={{ asset, repeatSize, rotation }} large />}
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
                    <p className="hint">
                        Личная текстура. Ресурс кампании можно скопировать в свою библиотеку через
                        Assets.
                    </p>
                    <div className="field-grid">
                        <NumberField
                            label="Ширина повтора, world units"
                            value={repeatSize}
                            min={1}
                            max={20000}
                            onChange={setRepeatSize}
                        />
                        <NumberField
                            label="Базовый поворот, °"
                            value={rotation}
                            min={0}
                            max={360}
                            onChange={setRotation}
                        />
                    </div>
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
                                    setVariation({ ...variation, quarterTurns: e.target.checked })
                                }
                            />{' '}
                            Повороты с шагом 90°
                        </label>
                    </details>
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
