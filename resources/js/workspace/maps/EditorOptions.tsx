import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SlidersHorizontal } from 'lucide-react';

export function useEditorPopover(
    open: boolean,
    root: RefObject<HTMLElement | null>,
    setOpen: (open: boolean) => void,
) {
    useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent) => {
            if (!(event.target instanceof Element) || root.current?.contains(event.target)) return;
            if (event.target.closest('.canvas-host canvas')) {
                event.preventDefault();
                event.stopPropagation();
            }
            const focused = document.activeElement;
            if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur();
            setOpen(false);
        };
        document.addEventListener('pointerdown', outside, true);
        return () => document.removeEventListener('pointerdown', outside, true);
    }, [open, root, setOpen]);
}

export function EditorOptions({
    label,
    summary,
    children,
}: {
    label: string;
    summary: string;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const id = useId();
    useEditorPopover(open, root, setOpen);
    return (
        <div
            className="map-editor-options"
            ref={root}
            onKeyDown={(event) => {
                if (!open || event.key !== 'Escape') return;
                event.stopPropagation();
                setOpen(false);
                trigger.current?.focus();
            }}
        >
            <button
                ref={trigger}
                aria-label={label}
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => setOpen(!open)}
            >
                <SlidersHorizontal size={14} /> {summary}
            </button>
            {open && (
                <div id={id} className="map-editor-options-content surface">
                    {children}
                </div>
            )}
        </div>
    );
}
