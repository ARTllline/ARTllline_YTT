import {
    Copy,
    Eye,
    EyeOff,
    Layers,
    Lock,
    SlidersHorizontal,
    Sparkles,
    Swords,
    Unlock,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import type { SceneStore } from '../../tabletop/state/SceneStore';
import type { SaveQueue } from '../../tabletop/state/SaveQueue';
import type { RightPanel } from '../workspaceState';
export type RadialTarget = { kind: 'token' | 'prop' | 'region'; id: string; x: number; y: number };
export function buildRadialActions(
    target: RadialTarget | null,
    store: SceneStore,
    queue: SaveQueue,
    onPanel: (panel: RightPanel) => Promise<void>,
) {
    const state = store.getSnapshot();
    const entity =
        target?.kind === 'token'
            ? state.scene.tokens.find((t) => t.id === target.id)
            : target?.kind === 'prop'
              ? state.scene.props?.find((p) => p.id === target.id)
              : state.scene.regions?.find((r) => r.id === target?.id);
    const select = () => {
        if (!target) return;
        if (target.kind === 'region') store.selectRegion(target.id);
        else store.selectObject(target.kind, target.id);
    };
    const panel = async (name: RightPanel) => {
        select();
        await onPanel(name);
    };
    const actions: {
        label: string;
        Icon: LucideIcon;
        run: () => void | Promise<void>;
        tone?: string;
    }[] = [];
    if (target && entity && store.role === 'gm') {
        actions.push({ label: 'Свойства', Icon: SlidersHorizontal, run: () => panel('context') });
        if (target.kind === 'region' && 'enabled' in entity) {
            actions.push(
                {
                    label: entity.enabled ? 'Выключить' : 'Включить',
                    Icon: Zap,
                    run: () =>
                        store.regionCommand({
                            ...entity,
                            action: 'update',
                            enabled: !entity.enabled,
                        }),
                },
                {
                    label: 'Триггеры',
                    Icon: Sparkles,
                    run: () => panel('triggers'),
                    tone: 'director',
                },
            );
        } else if (target.kind !== 'region' && !('enabled' in entity)) {
            const token = target.kind === 'token';
            if (token)
                actions.push({
                    label: 'В бой',
                    Icon: Swords,
                    tone: 'combat',
                    run: async () => {
                        if (!store.getSnapshot().scene.combat) {
                            store.combatCommand({ action: 'prepare' });
                            await queue.flush();
                        }
                        const combat = store.getSnapshot().scene.combat!;
                        if (!combat.combatants.some((c) => c.tokenId === target.id)) {
                            store.combatCommand({
                                action: 'add',
                                combatId: combat.id,
                                tokenIds: [target.id],
                            });
                            await queue.flush();
                        }
                        await onPanel('combat');
                    },
                });
            actions.push({
                label: entity.isHidden ? 'Показать' : 'Скрыть',
                Icon: entity.isHidden ? Eye : EyeOff,
                run: () => {
                    if (token) store.updateToken(target.id, { isHidden: !entity.isHidden });
                    else
                        store.objectCommand({
                            endpoint: 'props',
                            data: {
                                action: 'update',
                                id: target.id,
                                patch: { is_hidden: !entity.isHidden },
                            },
                        });
                },
            });
            actions.push({
                label: entity.isLocked ? 'Разблок.' : 'Закрепить',
                Icon: entity.isLocked ? Unlock : Lock,
                run: () => {
                    if (token) store.updateToken(target.id, { isLocked: !entity.isLocked });
                    else
                        store.objectCommand({
                            endpoint: 'props',
                            data: {
                                action: 'update',
                                id: target.id,
                                patch: { is_locked: !entity.isLocked },
                            },
                        });
                },
            });
            if (token)
                actions.push({
                    label: 'Состояния',
                    Icon: Sparkles,
                    run: async () => {
                        await panel('context');
                        requestAnimationFrame(() => {
                            const section = document.querySelector<HTMLDetailsElement>(
                                '.inspector-section:nth-of-type(2)',
                            );
                            if (section) {
                                section.open = true;
                                section.scrollIntoView({ block: 'nearest' });
                            }
                        });
                    },
                });
            else
                actions.push({
                    label: 'На передний',
                    Icon: Layers,
                    run: () =>
                        store.objectCommand({
                            endpoint: 'props',
                            data: { action: 'update', id: target.id, order: 'front' },
                        }),
                });
            actions.push({
                label: 'Копировать',
                Icon: Copy,
                run: () =>
                    store.objectCommand({
                        endpoint: 'selection',
                        data: {
                            action: 'duplicate',
                            tokenIds: token ? [target.id] : [],
                            propIds: token ? [] : [target.id],
                        },
                    }),
            });
            actions.push({
                label: 'Триггеры',
                Icon: Zap,
                run: () => panel('triggers'),
                tone: 'director',
            });
        }
    }
    return { entity, actions };
}
