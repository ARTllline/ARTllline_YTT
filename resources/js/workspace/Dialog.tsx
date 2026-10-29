import { t } from '../i18n';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        ref.current?.showModal();
    }, []);
    return (
        <dialog
            ref={ref}
            className="shortcuts-dialog editor-dialog"
            aria-labelledby={titleId}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
        >
            <div className="panel-heading">
                <strong id={titleId}>{title}</strong>
                <button className="icon-button" aria-label={t('Close dialog')} onClick={onClose}>
                    <X size={16} />
                </button>
            </div>
            {children}
        </dialog>
    );
}
