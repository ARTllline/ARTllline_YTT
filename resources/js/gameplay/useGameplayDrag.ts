import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { placeBinding, type HotbarSlots, type SlotBinding } from './hotbarModel';
import { GAMEPLAY_ENTRY_MIME, readGameplayEntry, writeGameplayEntry } from './gameplayDrag';

export function useGameplayDrag(
    slots: HotbarSlots,
    onLayout: (slots: HotbarSlots) => void,
    editable: boolean,
    accepts: (binding: SlotBinding) => boolean,
) {
    const [lifted, setLifted] = useState<string | null>(null);
    const [ghost, setGhost] = useState<{ binding: SlotBinding; x: number; y: number } | null>(null);
    const [over, setOver] = useState<number | null>(null);
    const [dropped, setDropped] = useState<number | null>(null);
    const refs = useRef({ slots, onLayout, accepts });
    useEffect(() => {
        refs.current = { slots, onLayout, accepts };
    });
    const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const dragging = useRef<SlotBinding | null>(null);
    const nativeActive = useRef(false);
    const suppress = useRef(false);
    const swipe = useRef<{ x: number; y: number; last: number; belt: HTMLElement | null } | null>(
        null,
    );
    useEffect(
        () => () => {
            clearTimeout(hold.current);
            clearTimeout(settling.current);
        },
        [],
    );
    const assign = (binding: SlotBinding, index: number) => {
        if (!editable || !refs.current.accepts(binding)) return;
        refs.current.onLayout(placeBinding(refs.current.slots, binding, index));
        setDropped(index);
        clearTimeout(settling.current);
        settling.current = setTimeout(() => setDropped(null), 220);
    };
    const end = () => {
        nativeActive.current = false;
        setLifted(null);
        setOver(null);
        setGhost(null);
        dragging.current = null;
    };
    const target = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-hotbar-slot]');
        return hit ? Number(hit.dataset.hotbarSlot) : null;
    };
    const source = (binding: SlotBinding) => ({
        draggable: editable,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        onDragStart: (e: React.DragEvent) => {
            nativeActive.current = true;
            writeGameplayEntry(e.dataTransfer, binding);
            dragging.current = binding;
            setLifted(binding.sourceId);
        },
        onDragEnd: end,
        onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
            suppress.current = false;
            if (e.pointerType !== 'touch' || !editable) return;
            const button = e.currentTarget,
                x = e.clientX,
                y = e.clientY;
            swipe.current = { x, y, last: x, belt: button.closest<HTMLElement>('.rpg-hotbar') };
            hold.current = setTimeout(() => {
                dragging.current = binding;
                setLifted(binding.sourceId);
                setGhost({ binding, x, y });
                button.setPointerCapture(e.pointerId);
            }, 230);
        },
        onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
            if (!dragging.current) {
                const s = swipe.current;
                if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) {
                    clearTimeout(hold.current);
                    if (s.belt && s.belt.scrollWidth > s.belt.clientWidth) {
                        s.belt.scrollLeft -= e.clientX - s.last;
                        suppress.current = true;
                    }
                }
                if (s) s.last = e.clientX;
                return;
            }
            e.preventDefault();
            setGhost({ binding, x: e.clientX, y: e.clientY });
            setOver(target(e.clientX, e.clientY));
        },
        onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
            clearTimeout(hold.current);
            swipe.current = null;
            if (!dragging.current) return;
            e.preventDefault();
            suppress.current = true;
            const index = target(e.clientX, e.clientY);
            if (index !== null) assign(dragging.current, index);
            end();
        },
        onPointerCancel: () => {
            clearTimeout(hold.current);
            swipe.current = null;
            if (!nativeActive.current) end();
        },
    });
    const destination = (index: number) => ({
        onDragOver: (e: React.DragEvent) => {
            if (editable && e.dataTransfer.types.includes(GAMEPLAY_ENTRY_MIME)) {
                e.preventDefault();
                setOver(index);
            }
        },
        onDragLeave: (e: React.DragEvent) => {
            if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))
                return;
            setOver(null);
        },
        onDrop: (e: React.DragEvent) => {
            const binding = readGameplayEntry(e.dataTransfer);
            if (!binding) return;
            e.preventDefault();
            assign(binding, index);
            end();
        },
    });
    return {
        source,
        destination,
        assign,
        lifted,
        ghost,
        over,
        dropped,
        consumeClick: () => {
            const value = suppress.current;
            suppress.current = false;
            return value;
        },
    };
}
export type GameplayDrag = ReturnType<typeof useGameplayDrag>;
