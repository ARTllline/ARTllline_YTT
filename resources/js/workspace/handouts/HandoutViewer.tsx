import { t } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus, X, Eye } from 'lucide-react';
import type { Handout } from '../../api/preparation';
export function HandoutViewer({
    handout,
    onClose,
    onShow,
}: {
    handout: Handout;
    onClose: () => void;
    onShow?: () => Promise<void>;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [scale, setScale] = useState(1),
        [pan, setPan] = useState({ x: 0, y: 0 }),
        [error, setError] = useState(''),
        [busy, setBusy] = useState(false),
        [shown, setShown] = useState(false);
    const drag = useRef<{ x: number; y: number; origin: typeof pan } | null>(null);
    const zoom = (factor: number) => setScale((s) => Math.max(0.5, Math.min(8, s * factor)));
    const fit = () => {
        setScale(1);
        setPan({ x: 0, y: 0 });
    };
    useEffect(() => {
        dialog.current?.showModal();
    }, []);
    return (
        <dialog
            ref={dialog}
            className="handout-viewer"
            onCancel={(e) => {
                e.preventDefault();
                onClose();
            }}
            onKeyDown={(e) => {
                if (e.key === '+') zoom(1.25);
                if (e.key === '-') zoom(0.8);
                if (e.key === '0') fit();
            }}
        >
            <header>
                <div>
                    <span className="eyebrow">
                        {onShow ? t('GM PREVIEW') : t('DISCOVERED HANDOUT')}
                    </span>
                    <h2>{handout.title}</h2>
                </div>
                <button className="icon-button" aria-label={t('Close handout')} onClick={onClose}>
                    <X size={20} />
                </button>
            </header>
            <div
                className="handout-image-stage"
                onWheel={(e) => zoom(e.deltaY > 0 ? 0.9 : 1.1)}
                onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = { x: e.clientX, y: e.clientY, origin: pan };
                }}
                onPointerMove={(e) => {
                    if (drag.current)
                        setPan({
                            x: drag.current.origin.x + e.clientX - drag.current.x,
                            y: drag.current.origin.y + e.clientY - drag.current.y,
                        });
                }}
                onPointerUp={() => {
                    drag.current = null;
                }}
                onPointerCancel={() => {
                    drag.current = null;
                }}
            >
                <img
                    src={handout.asset.url}
                    draggable={false}
                    alt={handout.title}
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                    onError={() =>
                        setError(
                            t('The handout image could not load. Close and reopen it to retry.'),
                        )
                    }
                />
            </div>
            {handout.description && <p className="handout-description">{handout.description}</p>}
            <footer>
                <div className="handout-zoom">
                    <button aria-label={t('Zoom handout out')} onClick={() => zoom(0.8)}>
                        <Minus size={17} />
                    </button>
                    <span>{Math.round(scale * 100)}%</span>
                    <button aria-label={t('Zoom handout in')} onClick={() => zoom(1.25)}>
                        <Plus size={17} />
                    </button>
                    <button aria-label={t('Fit handout')} onClick={fit}>
                        <Maximize size={17} />
                    </button>
                </div>
                <small> {t('Scroll to zoom · drag to pan · Esc to close')} </small>
                {onShow && (
                    <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            setError('');
                            void onShow()
                                .then(() => setShown(true))
                                .catch((e) => setError(e.message))
                                .finally(() => setBusy(false));
                        }}
                    >
                        <Eye size={15} />
                        {busy
                            ? t('Sharing…')
                            : shown
                              ? t('Show again to Players')
                              : t('Show to Players')}
                    </button>
                )}
            </footer>
            {shown && (
                <p role="status" className="hint">
                    {' '}
                    {t(
                        'Shared with current campaign players. They can reopen it from Handouts.',
                    )}{' '}
                </p>
            )}
            {error && (
                <p role="alert" className="form-error">
                    {error}
                </p>
            )}
        </dialog>
    );
}
