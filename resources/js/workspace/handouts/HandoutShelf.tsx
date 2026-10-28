import { t } from '../../i18n';
import { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { preparation } from '../../api/preparation';
import type { LiveEcho } from '../../realtime/useCampaignLive';
import { HandoutViewer } from './HandoutViewer';
import { useHandouts } from '../../realtime/useHandouts';
export function HandoutShelf({
    campaignId,
    userId,
    echo,
    gm = false,
}: {
    campaignId: string;
    userId: string;
    echo: LiveEcho | null;
    gm?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState(1);
    const { items, pages, error, selected, select, close } = useHandouts(
        campaignId,
        userId,
        echo,
        page,
        open,
    );
    return (
        <>
            <button
                className="secondary-button handout-launch"
                onClick={() => setOpen(!open)}
                title={t('Handouts')}
            >
                <BookOpen size={15} />
                <span> {t('Handouts')} </span>
            </button>
            {open && (
                <aside
                    className="handout-shelf panel"
                    aria-label={gm ? t('Prepared handouts') : t('Discovered handouts')}
                >
                    <div className="panel-heading">
                        <strong>{gm ? t('Prepared handouts') : t('Discovered handouts')}</strong>
                        <button
                            className="icon-button"
                            aria-label={t('Close handout shelf')}
                            onClick={() => setOpen(false)}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    {error && <p role="alert">{error}</p>}
                    <div className="asset-grid">
                        {items.map((item) => (
                            <button
                                key={item.id}
                                className="asset-card"
                                onClick={() => select(item)}
                            >
                                <img loading="lazy" src={item.thumbnailUrl} alt="" />
                                <strong>{item.title}</strong>
                            </button>
                        ))}
                    </div>
                    {!items.length && (
                        <p className="hint">
                            {gm
                                ? t('Prepare a handout image from Assets to preview and share it.')
                                : t('Handouts shared by your GM will stay here, across scenes.')}
                        </p>
                    )}
                    {pages > 1 && (
                        <div className="asset-pagination">
                            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                                {' '}
                                {t('Previous')}{' '}
                            </button>
                            <span>
                                {page} / {pages}
                            </span>
                            <button disabled={page === pages} onClick={() => setPage(page + 1)}>
                                {' '}
                                {t('Next')}{' '}
                            </button>
                        </div>
                    )}
                </aside>
            )}
            {selected && (
                <HandoutViewer
                    key={selected.id}
                    handout={selected}
                    campaignId={campaignId}
                    onClose={close}
                    onShow={
                        gm
                            ? () =>
                                  preparation
                                      .showHandout(campaignId, selected.id)
                                      .then(() => undefined)
                            : undefined
                    }
                />
            )}
        </>
    );
}
