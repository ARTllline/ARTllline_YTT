import { t } from '../../i18n';
import { useEffect, useState } from 'react';
import { Package, Swords, Trash2 } from 'lucide-react';
import { objects, type ContentTemplate } from '../../api/objects';
import { ConfirmDialog } from '../ConfirmDialog';
export const TEMPLATE_MIME = 'application/x-ytt-template';
export function readTemplateDrag(
    value: string,
): Pick<ContentTemplate, 'id' | 'kind' | 'name'> | null {
    try {
        const d = JSON.parse(value);
        return typeof d.id === 'string' &&
            /^\d+$/.test(d.id) &&
            ['prefab', 'encounter'].includes(d.kind) &&
            typeof d.name === 'string'
            ? d
            : null;
    } catch {
        return null;
    }
}
export function TemplateLibrary({
    campaignId,
    kind,
    refresh,
    onUse,
}: {
    campaignId: string;
    kind: 'prefab' | 'encounter';
    refresh: number;
    onUse: (template: Pick<ContentTemplate, 'id' | 'kind' | 'name'>) => void;
}) {
    const [search, setSearch] = useState(''),
        [page, setPage] = useState(1),
        [items, setItems] = useState<ContentTemplate[]>([]),
        [pages, setPages] = useState(1),
        [error, setError] = useState(''),
        [loading, setLoading] = useState(true),
        [removed, setRemoved] = useState(0),
        [deleting, setDeleting] = useState<ContentTemplate | null>(null);
    useEffect(() => {
        const abort = new AbortController();
        const timer = setTimeout(() => {
            void objects
                .templates(campaignId, kind, search, page, abort.signal)
                .then((d) => {
                    if (!abort.signal.aborted) {
                        setItems(d.templates);
                        setPages(d.pages);
                        setLoading(false);
                        setError('');
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
    }, [campaignId, kind, search, page, refresh, removed]);
    return (
        <section className="template-library">
            <label className="asset-search">
                <input
                    aria-label={t('Search templates')}
                    placeholder={t('Search by name…')}
                    value={search}
                    onChange={(e) => {
                        setSearch(e.target.value);
                        setPage(1);
                        setLoading(true);
                    }}
                />
            </label>
            <p className="hint"> {t('Drag onto the map, or click to place at the center.')} </p>
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
            {loading && <p role="status"> {t('Loading collection…')} </p>}
            {!loading && !items.length && (
                <div className="library-empty">
                    {kind === 'prefab' ? <Package /> : <Swords />}
                    <h2> {t('No templates yet')} </h2>
                    <p> {t('Select objects on the map and save the selection for later.')} </p>
                </div>
            )}
            <div className="template-cards">
                {items.map((item) => (
                    <div className="template-card" key={item.id}>
                        <button
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData(
                                    TEMPLATE_MIME,
                                    JSON.stringify({
                                        id: item.id,
                                        kind: item.kind,
                                        name: item.name,
                                    }),
                                );
                                e.dataTransfer.effectAllowed = 'copy';
                            }}
                            onClick={() => onUse(item)}
                        >
                            <div className="template-preview">
                                {item.items
                                    .slice(0, 4)
                                    .map((member, i) =>
                                        member.thumbnailUrl ? (
                                            <img
                                                key={i}
                                                src={member.thumbnailUrl}
                                                loading="lazy"
                                                alt=""
                                            />
                                        ) : (
                                            <Swords key={i} />
                                        ),
                                    )}
                            </div>
                            <strong>{item.name}</strong>
                            <small>
                                {item.count} {t('objects')}{' '}
                            </small>
                        </button>
                        <button
                            className="icon-button"
                            aria-label={t('Delete template')}
                            onClick={() => setDeleting(item)}
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ))}
            </div>
            {pages > 1 && (
                <div className="asset-pagination">
                    <button
                        disabled={page === 1}
                        aria-label={t('Previous page')}
                        onClick={() => {
                            setPage((p) => p - 1);
                            setLoading(true);
                        }}
                    >
                        ←
                    </button>
                    <span>
                        {page} / {pages}
                    </span>
                    <button
                        disabled={page === pages}
                        aria-label={t('Next page')}
                        onClick={() => {
                            setPage((p) => p + 1);
                            setLoading(true);
                        }}
                    >
                        →
                    </button>
                </div>
            )}
            {deleting && (
                <ConfirmDialog
                    title={t('Delete template?')}
                    description={t('Placed objects will remain on their scenes.')}
                    onClose={() => setDeleting(null)}
                    submit={async () => {
                        await objects.remove(campaignId, deleting.id);
                        setRemoved((n) => n + 1);
                        setPage(1);
                    }}
                />
            )}
        </section>
    );
}
