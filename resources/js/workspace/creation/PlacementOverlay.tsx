import { useLayoutEffect, useRef, type RefObject } from 'react';
import { MousePointer2, X } from 'lucide-react';
import type { TabletopRenderer } from '../../tabletop/renderer/TabletopRenderer';
import type { Point } from '../../tabletop/types/scene';
import type { Placement } from './model';

export function PlacementOverlay({
    item,
    renderer,
    busy,
    onPlace,
    onCancel,
}: {
    item: Placement;
    renderer: RefObject<TabletopRenderer | null>;
    busy: boolean;
    onPlace: (point: Point) => Promise<void>;
    onCancel: () => void;
}) {
    const marker = useRef<HTMLDivElement>(null);
    const placing = useRef(false);
    const latest = useRef({ busy, onPlace, onCancel });
    useLayoutEffect(() => {
        latest.current = { busy, onPlace, onCancel };
    }, [busy, onPlace, onCancel]);
    useLayoutEffect(() => {
        const host = marker.current!.parentElement!,
            canvas = host.querySelector('canvas');
        if (!canvas) return;
        let origin: Point | null = null,
            pan = false;
        const place = (point: Point) => {
            if (placing.current || latest.current.busy) return;
            placing.current = true;
            void latest.current.onPlace(point).finally(() => {
                placing.current = false;
            });
        };
        const move = (e: PointerEvent) => {
            if (!marker.current) return;
            const b = host.getBoundingClientRect();
            const point = renderer.current?.placementPreview(e.clientX, e.clientY) ?? {
                x: e.clientX - b.left,
                y: e.clientY - b.top,
            };
            marker.current!.hidden = false;
            marker.current!.style.transform = `translate(${point.x}px, ${point.y}px)`;
        };
        const down = (e: PointerEvent) => {
            if (e.button !== 0 || pan) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            renderer.current?.cancelGesture();
            origin = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
        };
        const up = (e: PointerEvent) => {
            if (!origin) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const start = origin;
            origin = null;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
            const target = renderer.current?.dropTarget(e.clientX, e.clientY);
            if (target) place(target.point);
        };
        const hide = () => {
            if (marker.current) marker.current.hidden = true;
        };
        const key = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement).closest('input,textarea,select,dialog')) return;
            if (e.code === 'Space') pan = true;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                latest.current.onCancel();
            }
            if (e.key === 'Enter' && e.target === canvas) {
                e.preventDefault();
                const point = renderer.current?.center();
                if (point) place(point);
            }
        };
        const keyup = (e: KeyboardEvent) => {
            if (e.code === 'Space') pan = false;
        };
        const cancel = () => {
            origin = null;
            pan = false;
            hide();
        };
        canvas.addEventListener('pointerdown', down, true);
        canvas.addEventListener('pointerup', up, true);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerleave', hide);
        canvas.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', key, true);
        window.addEventListener('keyup', keyup);
        window.addEventListener('blur', cancel);
        canvas.classList.add('is-placing');
        canvas.focus();
        return () => {
            canvas.classList.remove('is-placing');
            canvas.removeEventListener('pointerdown', down, true);
            canvas.removeEventListener('pointerup', up, true);
            canvas.removeEventListener('pointermove', move);
            canvas.removeEventListener('pointerleave', hide);
            canvas.removeEventListener('pointercancel', cancel);
            window.removeEventListener('keydown', key, true);
            window.removeEventListener('keyup', keyup);
            window.removeEventListener('blur', cancel);
        };
    }, [renderer]);
    const asset =
        item.type === 'token' ? item.draft.asset : item.type === 'prop' ? item.asset : undefined;
    return (
        <>
            <div className="creation-placement-bar" role="status">
                <MousePointer2 size={17} />
                <div>
                    <strong>{busy ? 'Размещаем…' : item.name}</strong>
                    <small>
                        {item.type === 'prop'
                            ? 'Клик — копия · Esc — закончить'
                            : 'Клик — разместить · Enter — в центре · Esc — отменить'}
                    </small>
                </div>
                <button
                    className="icon-button"
                    aria-label="Закончить размещение"
                    onClick={onCancel}
                >
                    <X size={17} />
                </button>
            </div>
            <div
                ref={marker}
                hidden
                className={`creation-ghost ${item.type === 'token' ? `disposition-${item.draft.disposition}` : ''}`}
                aria-hidden="true"
            >
                {asset ? <img src={asset.thumbnailUrl} alt="" /> : <MousePointer2 size={27} />}
                <span>{item.name}</span>
            </div>
        </>
    );
}
