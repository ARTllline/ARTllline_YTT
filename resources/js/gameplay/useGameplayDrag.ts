import { useEffect, useRef, useState } from 'react';
import { placeBinding, type HotbarSlots, type SlotBinding } from './hotbarModel';
import { useRpgDrag } from '../rpg/RpgDrag';

/** Deck adapter over the shared RPG pointer/drop engine. */
export function useGameplayDrag(
    slots: HotbarSlots,
    onLayout: (s: HotbarSlots) => void,
    editable: boolean,
    accepts: (b: SlotBinding) => boolean,
) {
    const engine = useRpgDrag(),
        latest = useRef({ slots, onLayout, accepts });
    useEffect(() => {
        latest.current = { slots, onLayout, accepts };
    });
    const [dropped, setDropped] = useState<number | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const assign = (b: SlotBinding, index: number) => {
        if (!editable || !latest.current.accepts(b)) return;
        latest.current.onLayout(placeBinding(latest.current.slots, b, index));
        setDropped(index);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDropped(null), 220);
    };
    return {
        source: (b: SlotBinding) => engine.source(b, editable),
        destination: (i: number) =>
            engine.destination(
                `deck:${i}`,
                (b) => editable && accepts(b),
                (b) => assign(b, i),
            ),
        assign,
        lifted: engine.active?.sourceId ?? null,
        over:
            engine.over?.key.startsWith('deck:') && engine.over.valid
                ? Number(engine.over.key.slice(5))
                : null,
        dropped,
        ghost: null,
        consumeClick: engine.consumeClick,
    };
}
export type GameplayDrag = ReturnType<typeof useGameplayDrag>;
