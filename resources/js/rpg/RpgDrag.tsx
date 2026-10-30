import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RpgIcon } from '../gameplay/RpgIcon';
import type { SlotBinding } from '../gameplay/hotbarModel';
import {
    GAMEPLAY_ENTRY_MIME,
    readGameplayEntry,
    writeGameplayEntry,
} from '../gameplay/gameplayDrag';

type Drop = { accepts: (b: SlotBinding) => boolean; drop: (b: SlotBinding) => void };
function useEntryDrag() {
    const [active, setActive] = useState<SlotBinding | null>(null);
    const [over, setOver] = useState<{ key: string; valid: boolean } | null>(null);
    const [ghost, setGhost] = useState<{ binding: SlotBinding; x: number; y: number } | null>(null);
    const drag = useRef<SlotBinding | null>(null),
        native = useRef(false),
        suppress = useRef(false);
    const targets = useRef(new Map<string, Drop>());
    const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const swipe = useRef<{ x: number; y: number; last: number; belt: HTMLElement | null } | null>(
        null,
    );
    const end = () => {
        drag.current = null;
        native.current = false;
        setActive(null);
        setOver(null);
        setGhost(null);
        clearTimeout(hold.current);
    };
    useEffect(() => () => clearTimeout(hold.current), []);
    const hit = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-gameplay-drop]')?.dataset
            .gameplayDrop;
    const source = (binding: SlotBinding, enabled = true) => ({
        draggable: enabled,
        onDragStart: (e: React.DragEvent) => {
            if (!enabled) {
                e.preventDefault();
                return;
            }
            native.current = true;
            drag.current = binding;
            setActive(binding);
            setGhost({ binding, x: e.clientX, y: e.clientY });
            writeGameplayEntry(e.dataTransfer, binding);
            const empty = document.createElement('canvas');
            empty.width = empty.height = 1;
            e.dataTransfer.setDragImage(empty, 0, 0);
        },
        onDrag: (e: React.DragEvent) => {
            if (native.current && drag.current && (e.clientX || e.clientY))
                setGhost({ binding: drag.current, x: e.clientX, y: e.clientY });
        },
        onDragEnd: end,
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
            suppress.current = false;
            if (e.pointerType !== 'touch' || !enabled) return;
            const button = e.currentTarget,
                x = e.clientX,
                y = e.clientY;
            swipe.current = { x, y, last: x, belt: button.closest<HTMLElement>('.rpg-hotbar') };
            hold.current = setTimeout(() => {
                drag.current = binding;
                setActive(binding);
                setGhost({ binding, x, y });
                button.setPointerCapture(e.pointerId);
            }, 230);
        },
        onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
            if (!drag.current) {
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
            if (native.current) return;
            e.preventDefault();
            setGhost({ binding, x: e.clientX, y: e.clientY });
            const key = hit(e.clientX, e.clientY),
                target = key ? targets.current.get(key) : undefined;
            setOver(key ? { key, valid: !!target?.accepts(binding) } : null);
        },
        onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
            clearTimeout(hold.current);
            swipe.current = null;
            if (!drag.current || native.current) return;
            e.preventDefault();
            suppress.current = true;
            const key = hit(e.clientX, e.clientY),
                target = key ? targets.current.get(key) : undefined;
            if (target?.accepts(drag.current)) target.drop(drag.current);
            end();
        },
        onPointerCancel: () => {
            clearTimeout(hold.current);
            swipe.current = null;
            if (!native.current) end();
        },
    });
    const destination = (key: string, accepts: Drop['accepts'], drop: Drop['drop']) => ({
        'data-gameplay-drop': key,
        ref: (node: HTMLElement | null) => {
            if (node) targets.current.set(key, { accepts, drop });
            else targets.current.delete(key);
        },
        onDragOver: (e: React.DragEvent) => {
            if (!e.dataTransfer.types.includes(GAMEPLAY_ENTRY_MIME)) return;
            e.preventDefault();
            const valid = !!drag.current && accepts(drag.current);
            e.dataTransfer.dropEffect = valid ? 'move' : 'none';
            setOver({ key, valid });
        },
        onDragLeave: (e: React.DragEvent) => {
            if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))
                return;
            setOver(null);
        },
        onDrop: (e: React.DragEvent) => {
            const b = readGameplayEntry(e.dataTransfer);
            if (b) {
                e.preventDefault();
                if (accepts(b)) drop(b);
            }
            end();
        },
    });
    return {
        source,
        destination,
        active,
        over,
        ghost,
        consumeClick: () => {
            const v = suppress.current;
            suppress.current = false;
            return v;
        },
    };
}
type EntryDrag = ReturnType<typeof useEntryDrag>;
const DragContext = createContext<EntryDrag | null>(null);
export function useRpgDrag() {
    const d = useContext(DragContext);
    if (!d) throw new Error('RPG drag provider missing');
    return d;
}
export function RpgDragProvider({
    children,
    icon,
}: {
    children: ReactNode;
    icon: (b: SlotBinding) => string;
}) {
    const drag = useEntryDrag();
    return (
        <DragContext.Provider value={drag}>
            {children}
            {drag.ghost &&
                createPortal(
                    <div
                        className="hotbar-drag-ghost"
                        style={{ left: drag.ghost.x + 12, top: drag.ghost.y - 65 }}
                    >
                        <RpgIcon icon={icon(drag.ghost.binding)} size={62} />
                    </div>,
                    document.body,
                )}
        </DragContext.Provider>
    );
}
