import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';

export function IconButton({
    label,
    children,
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
    return (
        <button type="button" className="icon-button" title={label} aria-label={label} {...props}>
            {children}
        </button>
    );
}

export function Panel({
    title,
    subtitle,
    onClose,
    children,
    className = '',
}: {
    title: string;
    subtitle?: string;
    onClose: () => void;
    children: ReactNode;
    className?: string;
}) {
    return (
        <section className={`workspace-panel ${className}`} aria-label={title}>
            <header className="workspace-panel-heading">
                <div>
                    {subtitle && <span className="eyebrow">{subtitle}</span>}
                    <h2>{title}</h2>
                </div>
                <IconButton label={`Закрыть: ${title}`} onClick={onClose}>
                    <X size={18} />
                </IconButton>
            </header>
            <div className="workspace-panel-content">{children}</div>
        </section>
    );
}
