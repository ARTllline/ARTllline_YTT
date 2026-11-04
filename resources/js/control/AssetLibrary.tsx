import { useEffect, useState } from 'react';
import { ImagePlus, Upload, Music, Search, Copy, Trash2 } from 'lucide-react';
import { request } from '../api/client';
import type { LibraryAsset } from '../api/preparation';
import type { ImageAsset } from '../tabletop/types/scene';
import { Dialog } from '../workspace/Dialog';
import { ConfirmDialog } from '../workspace/ConfirmDialog';
import '../../css/asset-library.css';

export const assetCategories = {
    portraits: 'Портреты',
    tokens: 'Токены',
    maps: 'Карты',
    props: 'Объекты',
    handouts: 'Раздаточные материалы',
    art: 'UI / Game art',
    audio: 'Аудио',
};
type Category = keyof typeof assetCategories;
type GlobalAsset = LibraryAsset & { category: Category };

export function AssetPicker({
    value,
    onChange,
    label = 'Выбрать из Assets',
    category,
    personalOnly = false,
}: {
    value?: ImageAsset | null;
    onChange: (a: GlobalAsset) => void;
    label?: string;
    category?: Category;
    personalOnly?: boolean;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
                <ImagePlus size={16} /> {label}
                {value && <img className="asset-picker-current" src={value.url} alt="" />}
            </button>
            {open && (
                <Dialog title="Assets · выбрать изображение" onClose={() => setOpen(false)}>
                    <AssetLibrary
                        images
                        onlyCategory={category}
                        personalOnly={personalOnly}
                        onSelect={(a) => {
                            onChange(a);
                            setOpen(false);
                        }}
                    />
                </Dialog>
            )}
        </>
    );
}

export function AssetIconPicker({
    icon,
    onChange,
}: {
    icon: string;
    onChange: (icon: string) => void;
}) {
    return (
        <AssetPicker
            value={
                /^asset:\d+$/.test(icon)
                    ? {
                          id: icon.slice(6),
                          url: `/api/assets/${icon.slice(6)}`,
                          width: 0,
                          height: 0,
                      }
                    : null
            }
            label="Иллюстрация из Assets"
            onChange={(a) => onChange(`asset:${a.id}`)}
        />
    );
}

export function AssetLibrary({
    images = false,
    onSelect,
    onlyCategory,
    personalOnly = false,
}: {
    images?: boolean;
    onSelect?: (a: GlobalAsset) => void;
    onlyCategory?: Category;
    personalOnly?: boolean;
}) {
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState<Category | ''>(onlyCategory ?? '');
    const [uploadCategory, setUploadCategory] = useState<Category>(
        onlyCategory ?? (images ? 'portraits' : 'art'),
    );
    const [audioKind, setAudioKind] = useState('music');
    const [page, setPage] = useState(1),
        [pages, setPages] = useState(1),
        [total, setTotal] = useState(0);
    const [assets, setAssets] = useState<GlobalAsset[] | null>(null);
    const [selected, setSelected] = useState<GlobalAsset>();
    const [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [revision, setRevision] = useState(0);
    const [dropping, setDropping] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setAssets(null);
            void request<{ assets: GlobalAsset[]; pages: number; total: number }>(
                `/library/assets?${new URLSearchParams({ search, category, page: String(page), images: images ? '1' : '0', personal: personalOnly ? '1' : '0' })}`,
                'GET',
                undefined,
                abort.signal,
            )
                .then((r) => {
                    setAssets(r.assets);
                    setPages(r.pages);
                    setTotal(r.total);
                })
                .catch((e) => {
                    if (!abort.signal.aborted) setError(e.message);
                });
        }, 180);
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [search, category, page, images, revision, personalOnly]);
    const changed = (a?: GlobalAsset) => {
        setSelected(a);
        setRevision((n) => n + 1);
    };
    const upload = async (files: File[]) => {
        if (busy || !files.length) return;
        setBusy(true);
        setError('');
        try {
            for (const file of files) {
                const form = new FormData();
                form.append('file', file);
                form.append('category', uploadCategory);
                form.append('kind', audioKind);
                const a = await request<GlobalAsset>('/library/assets', 'POST', form);
                setSelected(a);
            }
            setCategory('');
            setSearch('');
            setPage(1);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
            setRevision((n) => n + 1);
        }
    };
    return (
        <section
            className={`global-assets ${dropping ? 'is-dropping' : ''}`}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    setDropping(true);
                }
            }}
            onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                setDropping(false);
                void upload(Array.from(e.dataTransfer.files));
            }}
        >
            {!onSelect && (
                <header className="control-heading">
                    <div>
                        <span className="eyebrow">GM HUB / ASSET LIBRARY</span>
                        <h1>Assets</h1>
                        <p className="muted">
                            Один ресурс для персонажей, NPC, предметов, заклинаний и кампаний.
                        </p>
                    </div>
                </header>
            )}
            <div className="asset-upload-bar">
                <Upload size={22} />
                <div>
                    <strong>Перетащите файлы сюда</strong>
                    <small>PNG, JPEG, WebP · до 16 MB / аудио · до 64 MB</small>
                </div>
                <select
                    aria-label="Категория загрузки"
                    value={uploadCategory}
                    disabled={busy}
                    onChange={(e) => setUploadCategory(e.target.value as Category)}
                >
                    {Object.entries(assetCategories)
                        .filter(([k]) => !images || k !== 'audio')
                        .map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                </select>
                {uploadCategory === 'audio' && (
                    <select
                        aria-label="Тип аудио"
                        value={audioKind}
                        onChange={(e) => setAudioKind(e.target.value)}
                    >
                        <option value="music">Музыка</option>
                        <option value="ambient">Атмосфера</option>
                        <option value="sfx">Звуковой эффект</option>
                    </select>
                )}
                <label className="secondary-button">
                    {busy ? 'Загрузка…' : 'Загрузить'}
                    <input
                        type="file"
                        multiple
                        disabled={busy}
                        accept={
                            uploadCategory === 'audio'
                                ? 'audio/*'
                                : 'image/png,image/jpeg,image/webp'
                        }
                        onChange={(e) => {
                            void upload(Array.from(e.target.files ?? []));
                            e.target.value = '';
                        }}
                    />
                </label>
            </div>
            <div className="asset-library-tools">
                <Search size={16} />
                <input
                    aria-label="Поиск Assets"
                    placeholder="Поиск по имени или tags…"
                    maxLength={120}
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                    }}
                />
                <select
                    aria-label="Категория Assets"
                    disabled={!!onlyCategory}
                    value={category}
                    onChange={(e) => {
                        setCategory(e.target.value as Category);
                        setPage(1);
                    }}
                >
                    <option value="">Все категории</option>
                    {Object.entries(assetCategories)
                        .filter(([k]) => !images || k !== 'audio')
                        .map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                </select>
                <span className="muted">{total} ресурсов</span>
            </div>
            {error && (
                <p className="form-error" role="alert">
                    {error}{' '}
                    <button
                        type="button"
                        onClick={() => {
                            setError('');
                            setRevision((n) => n + 1);
                        }}
                    >
                        Повторить
                    </button>
                </p>
            )}
            <div className="asset-library-body">
                <div>
                    {assets === null ? (
                        <p role="status">Загрузка библиотеки…</p>
                    ) : assets.length === 0 ? (
                        <p className="asset-empty">
                            Ресурсы не найдены. Загрузите файл или измените поиск.
                        </p>
                    ) : (
                        <div className="global-asset-grid">
                            {assets.map((a) => (
                                <button
                                    type="button"
                                    className="global-asset-card"
                                    key={a.id}
                                    aria-pressed={selected?.id === a.id}
                                    onClick={() => setSelected(a)}
                                >
                                    {a.duration != null ? (
                                        <div className="asset-audio-cover">
                                            <Music size={36} />
                                        </div>
                                    ) : (
                                        <img src={a.thumbnailUrl} alt="" loading="lazy" />
                                    )}
                                    <strong>{a.name}</strong>
                                    <small>{assetCategories[a.category]}</small>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="asset-pagination">
                        <button
                            type="button"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            Назад
                        </button>
                        <span>
                            {page} / {pages}
                        </span>
                        <button
                            type="button"
                            disabled={page >= pages}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Далее
                        </button>
                    </div>
                </div>
                {selected && (
                    <AssetInspector
                        key={`${selected.id}-${selected.originalName}`}
                        asset={selected}
                        onChanged={changed}
                        onSelect={onSelect}
                    />
                )}
            </div>
            {dropping && (
                <div className="asset-drop-hint">
                    Отпустите файлы для загрузки · {assetCategories[uploadCategory]}
                </div>
            )}
        </section>
    );
}

function AssetInspector({
    asset,
    onChanged,
    onSelect,
}: {
    asset: GlobalAsset;
    onChanged: (a?: GlobalAsset) => void;
    onSelect?: (a: GlobalAsset) => void;
}) {
    const [name, setName] = useState(asset.name),
        [tags, setTags] = useState(asset.tags.map((t) => t.name).join(', '));
    const [usage, setUsage] = useState<string[] | null>(null),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [deleting, setDeleting] = useState(false);
    useEffect(() => {
        const abort = new AbortController();
        void request<{ usage: string[] }>(
            `/assets/${asset.id}/detail`,
            'GET',
            undefined,
            abort.signal,
        )
            .then((r) => setUsage(r.usage))
            .catch((e) => {
                if (!abort.signal.aborted) setError(e.message);
            });
        return () => abort.abort();
    }, [asset]);
    const run = async (fn: () => Promise<GlobalAsset>) => {
        setBusy(true);
        setError('');
        try {
            onChanged(await fn());
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };
    return (
        <aside className="global-asset-inspector">
            {asset.duration != null ? (
                <audio controls preload="none" src={asset.url} />
            ) : (
                <a href={asset.url} target="_blank" rel="noreferrer" title="Открыть оригинал">
                    <img className="global-asset-preview" src={asset.url} alt={asset.name} />
                </a>
            )}
            <small className="muted">
                {asset.mimeType} · {(asset.fileSize / 1048576).toFixed(2)} MB{' '}
                {asset.duration == null && `· ${asset.width} × ${asset.height}`}
            </small>
            {onSelect && (
                <button type="button" className="primary-button" onClick={() => onSelect(asset)}>
                    Выбрать ресурс
                </button>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            <fieldset disabled={busy}>
                <label className="field">
                    Название
                    <input value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="field">
                    Tags через запятую
                    <input value={tags} onChange={(e) => setTags(e.target.value)} />
                </label>
                <button
                    type="button"
                    className="secondary-button"
                    disabled={!name.trim()}
                    onClick={() =>
                        void run(() =>
                            request<GlobalAsset>(`/assets/${asset.id}`, 'PATCH', {
                                name,
                                tags: [
                                    ...new Set(
                                        tags
                                            .split(',')
                                            .map((v) => v.trim())
                                            .filter(Boolean),
                                    ),
                                ],
                            }),
                        )
                    }
                >
                    Сохранить
                </button>
                <div className="asset-management-actions">
                    <button
                        type="button"
                        onClick={() =>
                            void run(() =>
                                request<GlobalAsset>(
                                    `/library/assets/${asset.id}/duplicate`,
                                    'POST',
                                ),
                            )
                        }
                    >
                        <Copy size={14} /> Дубликат
                    </button>
                    <label className="secondary-button">
                        Заменить файл
                        <input
                            type="file"
                            accept={
                                asset.duration != null
                                    ? 'audio/*'
                                    : 'image/png,image/jpeg,image/webp'
                            }
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    const form = new FormData();
                                    form.append('file', file);
                                    void run(() =>
                                        request<GlobalAsset>(
                                            `/library/assets/${asset.id}/replace`,
                                            'POST',
                                            form,
                                        ),
                                    );
                                }
                                e.target.value = '';
                            }}
                        />
                    </label>
                </div>
                <p className="hint">
                    Замена сохраняет ID и обновляет ресурс во всех местах использования после
                    перезагрузки.
                </p>
                <strong>Использование</strong>
                {usage === null ? (
                    <p role="status">Проверка ссылок…</p>
                ) : usage.length ? (
                    <ul className="asset-reference-list">
                        {usage.map((u, i) => (
                            <li key={i}>{u}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="muted">Пока не используется</p>
                )}
                <button
                    type="button"
                    className="danger-button"
                    disabled={usage === null || usage.length > 0}
                    onClick={() => setDeleting(true)}
                >
                    <Trash2 size={14} /> Удалить
                </button>
            </fieldset>
            {deleting && (
                <ConfirmDialog
                    title="Удалить ресурс?"
                    description={`«${asset.name}» будет удалён из библиотеки.`}
                    onClose={() => setDeleting(false)}
                    submit={async () => {
                        await request(`/assets/${asset.id}`, 'DELETE');
                        onChanged();
                    }}
                />
            )}
        </aside>
    );
}
