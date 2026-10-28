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
}: {
    campaignId: string;
    onUse?: (asset: LibraryAsset) => void;
    pickerKind?: AssetKind;
}) {
    const [filters, setFilters] = useState({ ...initial, kind: pickerKind ?? '' });
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
            aria-label="Asset library"
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
                            ['', 'All'],
                            ['map', 'Maps'],
                            ['token', 'Tokens'],
                            ['handout', 'Handouts'],
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
                        aria-label="Search assets"
                        placeholder="Search names or tags…"
                        value={filters.search}
                        onChange={(e) => update({ search: e.target.value })}
                    />
                </label>
                <div className="asset-filter-row">
                    <select
                        aria-label="Filter collection"
                        value={filters.collection}
                        onChange={(e) => update({ collection: e.target.value })}
                    >
                        <option value="">All collections</option>
                        {data?.collections.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                    <select
                        aria-label="Filter tag"
                        value={filters.tag}
                        onChange={(e) => update({ tag: e.target.value })}
                    >
                        <option value="">All tags</option>
                        {data?.tags.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="asset-filter-row">
                    <select
                        aria-label="Asset order"
                        value={filters.sort}
                        onChange={(e) => update({ sort: e.target.value })}
                    >
                        <option value="newest">Recent uploads</option>
                        <option value="name">Name</option>
                    </select>
                    <small>{data?.total ?? 0} assets</small>
                </div>
                <div className="asset-filter-row">
                    <select
                        aria-label="Upload asset type"
                        value={kind}
                        onChange={(e) => setKind(e.target.value as AssetKind)}
                    >
                        <option value="map">Maps</option>
                        <option value="token">Tokens</option>
                        <option value="handout">Handouts</option>
                    </select>
                    <label className="upload-button">
                        <Upload size={14} />
                        {uploading ? 'Uploading…' : 'Upload'}
                        <input
                            type="file"
                            multiple
                            aria-label="Upload assets"
                            accept="image/png,image/jpeg,image/webp"
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
                            <small>{u.error ?? u.state}</small>
                        </div>
                    ))}
                    {!uploading && (
                        <button onClick={() => setUploads([])}>Clear upload results</button>
                    )}
                </div>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error} <button onClick={() => setRefresh((r) => r + 1)}>Retry</button>
                </p>
            )}
            {loading && <p className="hint">Loading collection…</p>}
            <div className={`asset-grid ${loading ? 'loading' : ''}`} aria-busy={loading}>
                {data?.assets.map((asset) => (
                    <button
                        key={asset.id}
                        className="asset-card"
                        draggable={!pickerKind}
                        title={`${asset.name} · ${asset.kind}. Drag onto the table or click for details.`}
                        onDragStart={(e) => {
                            e.dataTransfer.setData(ASSET_MIME, JSON.stringify(asset));
                            e.dataTransfer.setData(`application/x-ytt-${asset.kind}`, '1');
                            e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => (pickerKind && onUse ? onUse(asset) : setSelected(asset))}
                    >
                        <img src={asset.thumbnailUrl} loading="lazy" decoding="async" alt="" />
                        <strong>{asset.name}</strong>
                        <small>
                            {asset.kind} · {asset.width} × {asset.height}
                        </small>
                    </button>
                ))}
            </div>
            {!loading && !data?.assets.length && (
                <div className="asset-empty">
                    <Images size={28} />
                    <h3>
                        {filters.search || filters.tag || filters.collection
                            ? 'No matching assets'
                            : 'Make room for your world'}
                    </h3>
                    <p>Drop images here or upload your first map, token or handout.</p>
                    <button
                        onClick={() => {
                            setLoading(true);
                            setFilters({ ...initial, kind: pickerKind ?? '' });
                        }}
                    >
                        Clear filters
                    </button>
                </div>
            )}
            {data && data.pages > 1 && (
                <div className="asset-pagination">
                    <button
                        aria-label="Previous asset page"
                        disabled={loading || data.page === 1}
                        onClick={() => update({ page: data.page - 1 })}
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <span>
                        {data.page} / {data.pages}
                    </span>
                    <button
                        aria-label="Next asset page"
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
