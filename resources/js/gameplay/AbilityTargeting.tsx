import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { RpgIcon } from './RpgIcon';
import type { SceneStore } from '../tabletop/state/SceneStore';
import type { TabletopRenderer } from '../tabletop/renderer/TabletopRenderer';
import { abilityPreview, aimPoint } from './geometry';
import type { Ability, AbilityTarget } from './model';

export function AbilityTargeting({
    ability,
    actorTokenId,
    store,
    renderer,
    onSelect,
    onCancel,
}: {
    ability: Ability;
    actorTokenId?: string;
    store: SceneStore;
    renderer: RefObject<TabletopRenderer | null>;
    onSelect: (target: AbilityTarget, name: string) => void;
    onCancel: () => void;
}) {
    const mount = useRef<HTMLSpanElement>(null),
        callbacks = useRef({ onSelect, onCancel });
    const [hint, setHint] = useState({
        x: innerWidth / 2,
        y: innerHeight / 2,
        text: 'Выберите цель на карте',
        valid: true,
        confirm: false,
    });
    useEffect(() => {
        callbacks.current = { onSelect, onCancel };
    });
    useEffect(() => {
        const host = mount.current?.closest('.player-tabletop, .workspace'),
            instance = renderer.current;
        if (!host || !instance) return;
        const actor = () => {
            const s = store.getSnapshot().scene;
            return actorTokenId
                ? s.tokens.find((t) => t.id === actorTokenId)
                : s.tokens.find((t) => t.characterId === s.activeCharacterId && t.isOwner);
        };
        instance.cancelGesture();
        store.setAbilityTargeting(true);
        instance.setGameplayTarget(
            ability.target as 'token' | 'prop' | 'point',
            ability,
            actor()?.id,
        );
        let origin: { x: number; y: number } | null = null,
            current: AbilityTarget | null = null;
        let armed: { x: number; y: number } | null = null,
            keyboardIndex = -1;
        const update = (x: number, y: number, target?: AbilityTarget) => {
            const scene = store.getSnapshot().scene,
                a = actor();
            const hit = instance.contextTarget(x, y);
            const point = instance.dropTarget(x, y).point;
            current =
                target ??
                (ability.target === 'point' && a
                    ? { kind: 'point', ...aimPoint(ability, a, point, scene) }
                    : hit?.kind === ability.target
                      ? { kind: hit.kind as 'token' | 'prop', id: hit.id }
                      : null);
            const preview = abilityPreview(ability, scene, a, current);
            instance.hoverGameplayTarget(
                current
                    ? current.kind === 'point'
                        ? { kind: 'point', point: current }
                        : current
                    : undefined,
            );
            const unit = scene.grid.distanceUnit ?? 'ft';
            const range = ability.range
                ? `${Number(preview.distance.toFixed(1))} / ${preview.long ? preview.max : ability.range.normal} ${unit}${preview.long && preview.valid ? ' · дальняя' : ''}`
                : '';
            const area =
                ability.area && ability.area.shape !== 'none'
                    ? `${ability.area.shape === 'circle' ? 'радиус' : 'длина'} ${ability.area.size} ${unit} · Целей: ${preview.affected.length}`
                    : '';
            const friendlyCount = preview.affected.filter((id) =>
                scene.tokens.some((t) => t.id === id && t.disposition === 'friendly'),
            ).length;
            const valid = preview.valid;
            setHint({
                x,
                y,
                valid,
                confirm: !!armed,
                text: !current
                    ? 'Наведите на подходящую цель'
                    : !valid
                      ? `${range} · Вне дальности / сцены`
                      : [
                            range,
                            area,
                            friendlyCount ? `Союзников в области: ${friendlyCount}` : '',
                            armed ? 'Ещё раз нажмите для применения' : 'Нажмите, чтобы применить',
                        ]
                            .filter(Boolean)
                            .join(' · '),
            });
            host.querySelector('canvas')?.style.setProperty(
                'cursor',
                valid ? 'crosshair' : 'not-allowed',
            );
        };
        const confirm = (x: number, y: number) => {
            const scene = store.getSnapshot().scene,
                preview = abilityPreview(ability, scene, actor(), current);
            if (!current || !preview.valid) return;
            const heavy =
                ability.area &&
                ability.area.shape !== 'none' &&
                ((ability.area.shape === 'circle' && ability.area.size >= 15) ||
                    preview.affected.length >= 3 ||
                    ability.costs.some((c) => c.amount >= 2));
            if (heavy && (!armed || Math.hypot(x - armed.x, y - armed.y) > 16)) {
                armed = { x, y };
                update(x, y, current);
                return;
            }
            const chosen = current;
            const name =
                chosen.kind === 'point'
                    ? `Область · целей: ${preview.affected.length}`
                    : chosen.kind === 'token'
                      ? scene.tokens.find((t) => t.id === chosen.id)?.name
                      : scene.props?.find((p) => p.id === chosen.id)?.name;
            callbacks.current.onSelect(current, name ?? 'Объект');
        };
        const move = (event: Event) => {
            const e = event as PointerEvent;
            if (!(e.target instanceof HTMLCanvasElement)) return;
            if (armed && Math.hypot(e.clientX - armed.x, e.clientY - armed.y) > 16) armed = null;
            update(e.clientX, e.clientY);
        };
        const down = (event: Event) => {
            const e = event as PointerEvent;
            if (!(e.target instanceof HTMLCanvasElement) || e.button !== 0) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            origin = { x: e.clientX, y: e.clientY };
        };
        const up = (event: Event) => {
            const e = event as PointerEvent;
            if (!origin || e.button !== 0) return;
            const p = origin;
            origin = null;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
            update(e.clientX, e.clientY);
            confirm(e.clientX, e.clientY);
        };
        const cancel = (event: Event) => {
            if (event.target instanceof HTMLCanvasElement) {
                event.preventDefault();
                event.stopImmediatePropagation();
                callbacks.current.onCancel();
            }
        };
        const key = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                callbacks.current.onCancel();
                return;
            }
            if (e.target instanceof HTMLElement && e.target.closest('input,textarea,select'))
                return;
            const scene = store.getSnapshot().scene;
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const p =
                    current?.kind === 'point'
                        ? current
                        : abilityPreview(ability, scene, actor(), current).point;
                if (p) {
                    const screen = instance.screenPoint(p);
                    confirm(screen.x, screen.y);
                }
                return;
            }
            if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (ability.target === 'point') {
                    const p = current?.kind === 'point' ? current : actor();
                    if (!p) return;
                    const step = scene.grid.size;
                    const point = {
                        x:
                            p.x +
                            (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
                        y: p.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
                    };
                    const screen = instance.screenPoint(point);
                    update(screen.x, screen.y);
                } else {
                    const options = ability.target === 'token' ? scene.tokens : (scene.props ?? []);
                    if (!options.length) return;
                    keyboardIndex =
                        (keyboardIndex +
                            (e.shiftKey || e.key === 'ArrowLeft' ? -1 : 1) +
                            options.length) %
                        options.length;
                    const item = options[keyboardIndex],
                        screen = instance.screenPoint(item);
                    update(screen.x, screen.y, {
                        kind: ability.target as 'token' | 'prop',
                        id: item.id,
                    });
                }
            }
        };
        host.addEventListener('pointermove', move, true);
        host.addEventListener('pointerdown', down, true);
        host.addEventListener('pointerup', up, true);
        host.addEventListener('contextmenu', cancel, true);
        window.addEventListener('keydown', key, true);
        return () => {
            store.setAbilityTargeting(false);
            instance.setGameplayTarget();
            instance.hoverGameplayTarget();
            host.querySelector('canvas')?.style.removeProperty('cursor');
            host.removeEventListener('pointermove', move, true);
            host.removeEventListener('pointerdown', down, true);
            host.removeEventListener('pointerup', up, true);
            host.removeEventListener('contextmenu', cancel, true);
            window.removeEventListener('keydown', key, true);
        };
    }, [ability, actorTokenId, store, renderer]);
    return (
        <>
            <span ref={mount} />
            {createPortal(
                <div
                    className={`ability-cursor ${hint.valid ? '' : 'is-invalid'} ${hint.confirm ? 'is-armed' : ''}`}
                    style={{
                        left: Math.min(innerWidth - 260, Math.max(10, hint.x + 20)),
                        top: Math.min(innerHeight - 95, Math.max(10, hint.y + 24)),
                    }}
                    role="status"
                >
                    <RpgIcon icon={ability.icon} size={34} />
                    <div>
                        <strong>{ability.name}</strong>
                        <span>{hint.text}</span>
                        <small>
                            Esc / ПКМ — отменить · Tab / стрелки — цель · Enter — применить
                        </small>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
}
