import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { ScenePersistence } from '../../tabletop/state/ScenePersistence';
import { createDemoScene } from '../../tabletop/state/demoScene';
import { api } from '../../api/workspace';
import { ApiError } from '../../api/client';
import { reduceEvent } from '../../realtime/protocol';
import { SessionEncounters } from './SessionEncounters';
import type { EncounterRun, PreparedEncounter } from './model';

afterEach(() => vi.restoreAllMocks());
function fixture() {
    const encounter: PreparedEncounter = {
        id: 'encounter',
        name: 'Засада у моста',
        status: 'ready',
        groups: [
            { id: 'main', name: 'Основная группа', tokenIds: ['main'] },
            { id: 'reserve', name: 'Резерв', tokenIds: ['reserve'] },
        ],
    };
    const scene = { ...createDemoScene(), id: '7', revision: 1, encounters: [encounter] };
    const store = new SceneStore(scene);
    const persistence = new ScenePersistence(store, '7');
    const run: EncounterRun = {
        encounterId: encounter.id,
        combatId: 'combat',
        status: 'active',
        activatedTokenIds: ['main'],
    };
    return { store, queue: persistence.queue, scene, encounter, run };
}
it('keeps ambiguous runtime retries on one UUID without adding preparation history', async () => {
    const { store, queue, encounter, run } = fixture();
    const send = vi
        .spyOn(api, 'encounterCombat')
        .mockRejectedValueOnce(new ApiError('Связь потеряна', 0))
        .mockResolvedValue({ revision: 2, encounterRuns: [run] });
    store.encounterCombatCommand({
        id: encounter.id,
        action: 'start',
        expected: encounter,
        expectedCombatId: null,
    });
    await expect(queue.flush()).rejects.toThrow('Связь потеряна');
    queue.retry();
    await queue.flush();
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(store.getSnapshot().scene.encounterRuns).toEqual([run]);
    expect(store.history!.getSnapshot().undo).toBe('');
});
it('reconciles a combat confirmation conflict and allows the next command', async () => {
    const { store, queue, encounter, scene, run } = fixture();
    vi.spyOn(api, 'encounterCombat').mockRejectedValue(new ApiError('Бой изменился', 409));
    vi.spyOn(api, 'snapshot').mockResolvedValue({ ...scene, revision: 2, encounterRuns: [run] });
    store.encounterCombatCommand({
        id: encounter.id,
        action: 'start',
        expected: encounter,
        expectedCombatId: null,
    });
    await queue.flush();
    expect(queue.getSnapshot().status).toBe('saved');
    expect(store.getSnapshot().editorNotice).toBe('Бой изменился');
    expect(store.getSnapshot().scene.encounterRuns).toEqual([run]);
});
it('hydrates runtime over realtime, retains completion, and ignores old receipts', () => {
    const { scene, store, run } = fixture();
    const event = {
        type: 'encounter.combat',
        sceneId: '7',
        revision: 2,
        mutationId: 'remote',
        payload: { encounterRuns: [run] },
    };
    const active = reduceEvent(scene, event);
    expect(active).not.toBe('gap');
    if (active === 'gap') return;
    const ended = reduceEvent(active, {
        ...event,
        revision: 3,
        payload: { encounterRuns: [{ ...run, status: 'ended' }] },
    });
    if (ended === 'gap') throw Error('Unexpected gap');
    store.reconcile(ended);
    store.accept({ revision: 2, encounterRuns: [run] }, true);
    expect(store.getSnapshot().scene.encounterRuns?.[0].status).toBe('ended');
    expect(reduceEvent(active, { ...event, revision: 4 })).toBe('gap');
});
it('shows composition and truthful completed state without preparation controls', () => {
    const { store, queue, scene, run } = fixture();
    const render = () =>
        renderToStaticMarkup(
            <SessionEncounters
                store={store}
                queue={queue}
                onClose={() => {}}
                onCombat={() => {}}
            />,
        );
    expect(render()).toContain('Засада у моста');
    expect(render()).toContain('Подготовлено');
    store.reconcile({ ...scene, revision: 2, encounterRuns: [{ ...run, status: 'ended' }] });
    const html = render();
    expect(html).toContain('Завершено');
    expect(html).not.toContain('Новое столкновение');
    expect(html).not.toContain('Название столкновения');
    expect(html).not.toContain('Статус подготовки');
});
it('does not dispatch runtime commands or render GM composition for Players', () => {
    const { scene, encounter, queue } = fixture();
    const player = new SceneStore(scene, 'player');
    const commands = vi.fn();
    player.bindCommands(commands);
    player.encounterCombatCommand({
        id: encounter.id,
        action: 'start',
        expected: encounter,
        expectedCombatId: null,
    });
    expect(commands).not.toHaveBeenCalled();
    expect(
        renderToStaticMarkup(
            <SessionEncounters
                store={player}
                queue={queue}
                onClose={() => {}}
                onCombat={() => {}}
            />,
        ),
    ).toBe('');
});
