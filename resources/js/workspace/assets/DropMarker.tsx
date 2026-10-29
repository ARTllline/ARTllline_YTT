import { useEffect, useRef } from 'react';
import { ASSET_MIME } from './assetDrag';
import { TEMPLATE_MIME } from '../objects/TemplateLibrary';
/** Pointer feedback is local to the DOM, never scene state or a React animation loop. */
export function DropMarker() {
    const marker = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = marker.current!,
            host = element.parentElement!;
        const hide = () => {
            element.hidden = true;
        };
        const over = (event: DragEvent) => {
            if ((event.target as HTMLElement).closest('.creation-hub')) {
                hide();
                return;
            }
            if (
                !event.dataTransfer?.types.some((type) =>
                    [ASSET_MIME, TEMPLATE_MIME, 'Files'].includes(type),
                )
            )
                return;
            const bounds = host.getBoundingClientRect();
            element.hidden = false;
            element.style.transform = `translate(${event.clientX - bounds.left}px, ${event.clientY - bounds.top}px)`;
        };
        const leave = (event: DragEvent) => {
            if (!host.contains(event.relatedTarget as Node)) hide();
        };
        host.addEventListener('dragover', over);
        host.addEventListener('dragleave', leave);
        host.addEventListener('drop', hide);
        window.addEventListener('dragend', hide);
        return () => {
            host.removeEventListener('dragover', over);
            host.removeEventListener('dragleave', leave);
            host.removeEventListener('drop', hide);
            window.removeEventListener('dragend', hide);
        };
    }, []);
    return (
        <div ref={marker} className="drop-marker" hidden aria-hidden="true">
            <i />
            <span>Отпустите здесь</span>
        </div>
    );
}
