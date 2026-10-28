import { useEffect, useRef, type ReactNode } from 'react';
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
    useEffect(() => {
        ref.current?.showModal();
    }, []);
    return (
        <dialog ref={ref} className="shortcuts-dialog editor-dialog" onCancel={onClose}>
            <div className="panel-heading">
                <strong>{title}</strong>
                <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
                    <X size={16} />
                </button>
            </div>
            {children}
        </dialog>
    );
}
