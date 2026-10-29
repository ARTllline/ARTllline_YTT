import { useEffect, useRef, useState, type RefObject } from 'react';
import { Crosshair, X } from 'lucide-react';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import { targetLabels, type Ability, type AbilityTarget } from './model';

export function AbilityTargeting({
    ability,
    store,
    renderer,
    onSelect,
    onCancel,
}: {
    ability: Ability;
    store: SceneStore;
    renderer: RefObject<TabletopRenderer | null>;
    onSelect: (target: AbilityTarget, name: string) => void;
    onCancel: () => void;
}) {
    const mount = useRef<HTMLDivElement>(null);
    const callbacks = useRef({ onSelect, onCancel });
    const [invalid, setInvalid] = useState(false);
    useEffect(() => {
        callbacks.current = { onSelect, onCancel };
    });
    useEffect(() => {
        const host = mount.current?.closest('.player-tabletop');
        const instance = renderer.current;
        if (!host || !instance) return;
        instance.cancelGesture();
        store.setAbilityTargeting(true);
        instance.setGameplayTarget(ability.target as 'token' | 'prop' | 'point');
        let origin: { x: number; y: number } | null = null;
        const targetAt = (e: PointerEvent) => {
            if (ability.target === 'point') {
                const p = instance.dropTarget(e.clientX, e.clientY).point;
                const scene = store.getSnapshot().scene;
                return p.x >= 0 && p.y >= 0 && p.x <= scene.width && p.y <= scene.height
                    ? { kind: 'point' as const, ...p }
                    : null;
            }
            const hit = instance.contextTarget(e.clientX, e.clientY);
            return hit?.kind === ability.target
                ? { kind: hit.kind as 'token' | 'prop', id: hit.id }
                : null;
        };
        const move = (e: Event) => {
            const event = e as PointerEvent;
            if (!(event.target instanceof HTMLCanvasElement)) return;
            const target = targetAt(event);
            instance.hoverGameplayTarget(
                target
                    ? { ...target, ...(target.kind === 'point' ? { point: target } : {}) }
                    : undefined,
            );
            (event.target as HTMLCanvasElement).style.cursor = target ? 'crosshair' : 'not-allowed';
        };
        const down = (e: Event) => {
            const event = e as PointerEvent;
            if (!(event.target instanceof HTMLCanvasElement) || event.button !== 0) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            origin = { x: event.clientX, y: event.clientY };
        };
        const up = (e: Event) => {
            const event = e as PointerEvent;
            if (!origin || event.button !== 0) return;
            const p = origin;
            origin = null;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (Math.hypot(event.clientX - p.x, event.clientY - p.y) > 12) return;
            const target = targetAt(event);
            if (!target) {
                setInvalid(true);
                return;
            }
            const scene = store.getSnapshot().scene;
            const name =
                target.kind === 'point'
                    ? 'Точка мира'
                    : target.kind === 'token'
                      ? scene.tokens.find((t) => t.id === target.id)?.name
                      : scene.props?.find((p) => p.id === target.id)?.name;
            callbacks.current.onSelect(target, name ?? 'Объект');
        };
        const cancel = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                callbacks.current.onCancel();
            }
        };
        const blockContext = (e: Event) => {
            if (e.target instanceof HTMLCanvasElement) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        };
        host.addEventListener('pointermove', move, true);
        host.addEventListener('pointerdown', down, true);
        host.addEventListener('pointerup', up, true);
        host.addEventListener('contextmenu', blockContext, true);
        window.addEventListener('keydown', cancel, true);
        return () => {
            store.setAbilityTargeting(false);
            instance.setGameplayTarget();
            instance.hoverGameplayTarget();
            host.querySelector('canvas')?.style.removeProperty('cursor');
            host.removeEventListener('pointermove', move, true);
            host.removeEventListener('pointerdown', down, true);
            host.removeEventListener('pointerup', up, true);
            host.removeEventListener('contextmenu', blockContext, true);
            window.removeEventListener('keydown', cancel, true);
        };
    }, [ability, store, renderer]);
    const scene = store.getSnapshot().scene;
    const targets = ability.target === 'token' ? scene.tokens : (scene.props ?? []);
    return (
        <div
            ref={mount}
            className={`ability-targeting ${invalid ? 'is-invalid' : ''}`}
            role="status"
        >
            <Crosshair size={20} />
            <div>
                <strong>{ability.name}</strong>
                <span>
                    {invalid
                        ? 'Эта цель не подходит. Выберите подсвеченную.'
                        : `Выберите цель · ${targetLabels[ability.target]}`}
                </span>
            </div>
            {ability.target !== 'point' && (
                <select
                    aria-label="Цель способности"
                    value=""
                    onChange={(e) => {
                        const target = targets.find((t) => t.id === e.target.value);
                        if (target)
                            onSelect(
                                { kind: ability.target as 'token' | 'prop', id: target.id },
                                target.name ?? 'Объект',
                            );
                    }}
                >
                    <option value="">Выбрать…</option>
                    {targets.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name ?? 'Объект'}
                        </option>
                    ))}
                </select>
            )}
            <button className="icon-button" onClick={onCancel} aria-label="Отменить выбор цели">
                <X size={18} />
            </button>
        </div>
    );
}
