import { CREATION_MIME } from '../creation/model';
import { t } from '../../i18n';
import { isAudio, durationLabel } from '../../media/model';
import { AudioPreview } from '../../media/AudioPreview';
import { audioEngine } from '../../media/AudioEngine';
import { useEffect, useState } from 'react';
import { Images, Search, Upload, ChevronLeft, ChevronRight } from 'lucide-react';
import {
    preparation,
    type AssetKind,
    type LibraryAsset,
    type LibraryPage,
    type LibraryFilters,
} from '../../api/preparation';
import { ASSET_MIME, uploadBatch } from './assetDrag';
import { AssetDetails } from './AssetDetails';
const initial: LibraryFilters = {
    kind: '',
    search: '',
    tag: '',
    collection: '',
    sort: 'newest',
    page: 1,
};
export function AssetLibrary({
    campaignId,
    onUse,
    pickerKind,
    creationKind,
}: {
    campaignId: string;
    onUse?: (asset: LibraryAsset) => void;
    pickerKind?: AssetKind;
    creationKind?: 'hero' | 'enemy' | 'prop';
}) {
    const [filters, setFilters] = useState({ ...initial, kind: pickerKind ?? '' });
    useEffect(() => () => audioEngine.stopPreview(), []);
    const [data, setData] = useState<LibraryPage>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);
    const [selected, setSelected] = useState<LibraryAsset | null>(null);
    const [kind, setKind] = useState<AssetKind>(pickerKind ?? 'map');
    const [uploads, setUploads] = useState<{ name: string; state: string; error?: string }[]>([]);
    const uploading = uploads.some((u) => u.state === 'waiting' || u.state === 'uploading');
    const update = (patch: Partial<LibraryFilters>) => {
        setLoading(true);
        setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
    };
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            void preparation
                .assets(campaignId, filters, abort.signal)
                .then((value) => {
                    if (!abort.signal.aborted) {
                        setData(value);
                        setError('');
                        setLoading(false);
                    }
                })
                .catch((e) => {
                    if (!abort.signal.aborted) {
                        setError(e.message);
                        setLoading(false);
                    }
                });
        }, 250);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [campaignId, filters, refresh]);
    const upload = async (files: File[]) => {
        if (uploading || !files.length) return;
        setUploads(files.map((file) => ({ name: file.name, state: 'waiting' })));
        await uploadBatch(
            files,
            (file) => preparation.upload(campaignId, file, kind),
            (index, state, error) =>
                setUploads((all) =>
                    all.map((item, i) => (i === index ? { ...item, state, error } : item)),
                ),
        );
        setRefresh((r) => r + 1);
    };
    return (
        <section
            className="asset-library"
            aria-label={t('Asset library')}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes('Files')) e.preventDefault();
            }}
            onDrop={(e) => {
                if (e.dataTransfer.files.length) {
                    e.preventDefault();
                    e.stopPropagation();
                    void upload([...e.dataTransfer.files]);
                }
            }}
        >
            <div className="asset-filters">
                {!pickerKind && (
                    <div className="asset-kinds">
                        {[
                            ['', t('All')],
                            ['map', t('Maps')],
                            ['token', t('Tokens')],
                            ['prop', t('Objects')],
                            ['handout', t('Handouts')],
                            ['music', 'Музыка'],
                            ['ambient', 'Атмосфера'],
                            ['sfx', 'Звуки'],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                aria-pressed={filters.kind === value}
                                onClick={() => {
                                    update({ kind: value });
                                    if (value) setKind(value as AssetKind);
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
                <label className="asset-search">
                    <Search size={14} />
                    <input
                        aria-label={t('Search assets')}
                        placeholder={t('Search names or tags…')}
                        value={filters.search}
                        onChange={(e) => update({ search: e.target.value })}
                    />
                </label>
                <details className="asset-advanced-filters">
                    <summary>
                        Коллекции, теги и порядок
                        {filters.collection || filters.tag ? ' · есть фильтр' : ''}
                    </summary>
                    <div className="asset-filter-row">
                        <select
                            aria-label={t('Filter collection')}
                            value={filters.collection}
                            onChange={(e) => update({ collection: e.target.value })}
                        >
                            <option value=""> {t('All collections')} </option>
                            {data?.collections.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label={t('Filter tag')}
                            value={filters.tag}
                            onChange={(e) => update({ tag: e.target.value })}
                        >
                            <option value=""> {t('All tags')} </option>
                            {data?.tags.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="asset-filter-row">
                        <select
                            aria-label={t('Asset order')}
                            value={filters.sort}
                            onChange={(e) => update({ sort: e.target.value })}
                        >
                            <option value="newest"> {t('Recent uploads')} </option>
                            <option value="name"> {t('Name')} </option>
                        </select>
                        <small>
                            {data?.total ?? 0} {t('assets')}{' '}
                        </small>
                    </div>
                </details>
                <div className="asset-filter-row">
                    <select
                        aria-label={t('Upload asset type')}
                        value={kind}
                        disabled={!!pickerKind}
                        onChange={(e) => setKind(e.target.value as AssetKind)}
                    >
                        <option value="map"> {t('Maps')} </option>
                        <option value="token"> {t('Tokens')} </option>
                        <option value="prop"> {t('Objects')} </option>
                        <option value="handout"> {t('Handouts')} </option>
                        <option value="music">Музыка</option>
                        <option value="ambient">Атмосфера</option>
                        <option value="sfx">Звуки</option>
                    </select>
                    <label className="upload-button">
                        <Upload size={14} />
                        {uploading ? t('Uploading…') : t('Upload')}
                        <input
                            type="file"
                            multiple
                            aria-label={t('Upload assets')}
                            accept={
                                isAudio(kind) ? '.mp3,.ogg,.wav' : 'image/png,image/jpeg,image/webp'
                            }
                            disabled={uploading}
                            onChange={(e) => {
                                void upload([...(e.target.files ?? [])]);
                                e.target.value = '';
                            }}
                        />
                    </label>
                </div>
            </div>
            {uploads.length > 0 && (
                <div className="upload-results" aria-live="polite">
                    {uploads.map((u, i) => (
                        <div key={i} className={u.state}>
                            <span>{u.name}</span>
                            <small>
                                {u.error ??
                                    t(`upload.${u.state}` as import('../../i18n').TranslationKey)}
                            </small>
                        </div>
                    ))}
                    {!uploading && (
                        <button onClick={() => setUploads([])}>
                            {' '}
                            {t('Clear upload results')}{' '}
                        </button>
                    )}
                </div>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error} <button onClick={() => setRefresh((r) => r + 1)}> {t('Retry')} </button>
                </p>
            )}
            {loading && <p className="hint"> {t('Loading collection…')} </p>}
            <div className={`asset-grid ${loading ? 'loading' : ''}`} aria-busy={loading}>
                {data?.assets.map((asset) =>
                    isAudio(asset.kind) ? (
                        <div className="audio-card" key={asset.id}>
                            <button
                                title={
                                    pickerKind ? `Выбрать ${asset.name}` : `Свойства ${asset.name}`
                                }
                                onClick={() =>
                                    pickerKind && onUse ? onUse(asset) : setSelected(asset)
                                }
                            >
                                <span className="audio-glyph" aria-hidden="true">
                                    ♫
                                </span>
                                <strong>{asset.name}</strong>
                                <small>
                                    {t(`kind.${asset.kind}`)} · {durationLabel(asset.duration ?? 0)}
                                </small>
                            </button>
                            <AudioPreview asset={asset} />
                        </div>
                    ) : (
                        <button
                            key={asset.id}
                            className="asset-card"
                            draggable={!pickerKind || !!creationKind}
                            title={t('assetCardHint', {
                                name: asset.name,
                                kind: t(`kind.${asset.kind}`),
                            })}
                            onDragStart={(e) => {
                                e.currentTarget.classList.add('is-dragging');
                                if (creationKind)
                                    e.dataTransfer.setData(
                                        CREATION_MIME,
                                        JSON.stringify({ assetId: asset.id, preset: creationKind }),
                                    );
                                e.dataTransfer.setData(ASSET_MIME, JSON.stringify(asset));
                                e.dataTransfer.setData(`application/x-ytt-${asset.kind}`, '1');
                                e.dataTransfer.effectAllowed = 'copy';
                            }}
                            onDragEnd={(e) => e.currentTarget.classList.remove('is-dragging')}
                            onClick={() =>
                                pickerKind && onUse ? onUse(asset) : setSelected(asset)
                            }
                        >
                            <img src={asset.thumbnailUrl} loading="lazy" decoding="async" alt="" />
                            <strong>{asset.name}</strong>
                            <small>
                                {t(`kind.${asset.kind}`)} · {asset.width} × {asset.height}
                            </small>
                        </button>
                    ),
                )}
            </div>
            {!loading && !data?.assets.length && (
                <div className="asset-empty">
                    <Images size={28} />
                    <h3>
                        {filters.search || filters.tag || filters.collection
                            ? t('No matching assets')
                            : pickerKind === 'token'
                              ? 'Добавьте первый портрет'
                              : pickerKind === 'prop'
                                ? 'Объекты для вашей сцены'
                                : pickerKind === 'map'
                                  ? 'Выберите первую карту'
                                  : t('Make room for your world')}
                    </h3>
                    <p>
                        {isAudio(filters.kind)
                            ? 'Перетащите MP3, OGG или WAV сюда. До 64 МБ, стерео или моно, до 2 часов.'
                            : pickerKind
                              ? 'Перетащите изображение сюда или загрузите его кнопкой выше.'
                              : t('Drop images here or upload your first map, token or handout.')}
                    </p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            setFilters({ ...initial, kind: pickerKind ?? '' });
                        }}
                    >
                        {' '}
                        {t('Clear filters')}{' '}
                    </button>
                </div>
            )}
            {data && data.pages > 1 && (
                <div className="asset-pagination">
                    <button
                        aria-label={t('Previous asset page')}
                        disabled={loading || data.page === 1}
                        onClick={() => update({ page: data.page - 1 })}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span>
                        {data.page} / {data.pages}
                    </span>
                    <button
                        aria-label={t('Next asset page')}
                        disabled={loading || data.page === data.pages}
                        onClick={() => update({ page: data.page + 1 })}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            )}
            {selected && (
                <AssetDetails
                    key={selected.id}
                    asset={selected}
                    campaignId={campaignId}
                    onClose={() => setSelected(null)}
                    onChanged={() => setRefresh((r) => r + 1)}
                    onUse={onUse}
                />
            )}
        </section>
    );
}
