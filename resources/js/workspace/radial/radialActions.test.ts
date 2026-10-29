import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRadialActions } from './radialActions';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { SaveQueue } from '../../tabletop/state/SaveQueue';
import { createDemoScene } from '../../tabletop/state/demoScene';
import type { Combat } from '../../tabletop/types/combat';
afterEach(() => vi.restoreAllMocks());
const target = { kind: 'token' as const, id: 'kern', x: 100, y: 100 };
describe('radial commands reuse existing authority paths', () => {
    it('opens without selecting and duplicates only the context target, not previous selection', () => {
        const store = new SceneStore(createDemoScene()),
            queue = new SaveQueue();
        store.select('mira');
        const command = vi.spyOn(store, 'objectCommand');
        const { actions } = buildRadialActions(target, store, queue, vi.fn());
        expect(store.getSnapshot().selectedIds).toEqual(['mira']);
        expect(actions).toHaveLength(7);
        expect(actions.some((a) => /Удалить/.test(a.label))).toBe(false);
        actions.find((a) => a.label === 'Копировать')!.run();
        expect(command).toHaveBeenCalledWith({
            endpoint: 'selection',
            data: { action: 'duplicate', tokenIds: ['kern'], propIds: [] },
        });
    });
    it('prepares, waits for the server combat, adds once, then opens the panel', async () => {
        const store = new SceneStore(createDemoScene()),
            queue = new SaveQueue(),
            panel = vi.fn();
        const combat: Combat = {
            id: 'server-combat',
            status: 'preparing',
            round: 0,
            currentTurn: null,
            combatants: [],
        };
        const command = vi.spyOn(store, 'combatCommand');
        vi.spyOn(queue, 'flush').mockImplementation(async () => {
            store.reconcile({ ...store.getSnapshot().scene, combat });
        });
        await buildRadialActions(target, store, queue, panel)
            .actions.find((a) => a.label === 'В бой')!
            .run();
        expect(command.mock.calls).toEqual([
            [{ action: 'prepare' }],
            [{ action: 'add', combatId: combat.id, tokenIds: ['kern'] }],
        ]);
        expect(panel).toHaveBeenCalledWith('combat');
        command.mockClear();
        combat.combatants.push({ id: '1', tokenId: 'kern', initiative: null });
        await buildRadialActions(target, store, queue, panel)
            .actions.find((a) => a.label === 'В бой')!
            .run();
        expect(command).not.toHaveBeenCalled();
    });
    it('does not continue to add combatants or navigate after a failed prepare', async () => {
        const store = new SceneStore(createDemoScene()),
            queue = new SaveQueue(),
            panel = vi.fn();
        const command = vi.spyOn(store, 'combatCommand');
        vi.spyOn(queue, 'flush').mockRejectedValue(new Error('offline'));
        await expect(
            buildRadialActions(target, store, queue, panel)
                .actions.find((a) => a.label === 'В бой')!
                .run(),
        ).rejects.toThrow('offline');
        expect(command).toHaveBeenCalledTimes(1);
        expect(panel).not.toHaveBeenCalled();
    });
    it('drops actions for a removed target and keeps region updates in the region command', () => {
        const store = new SceneStore({
            ...createDemoScene(),
            regions: [
                {
                    id: 'r',
                    name: 'Entrance',
                    enabled: true,
                    shape: 'rectangle',
                    geometry: { x: 10, y: 10, width: 100, height: 50 },
                },
            ],
        });
        const queue = new SaveQueue(),
            command = vi.spyOn(store, 'regionCommand');
        expect(
            buildRadialActions({ ...target, id: 'missing' }, store, queue, vi.fn()).actions,
        ).toEqual([]);
        const { actions } = buildRadialActions(
            { ...target, kind: 'region', id: 'r' },
            store,
            queue,
            vi.fn(),
        );
        expect(actions).toHaveLength(3);
        actions.find((a) => a.label === 'Выключить')!.run();
        expect(command).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'r', action: 'update', enabled: false }),
        );
    });
});
