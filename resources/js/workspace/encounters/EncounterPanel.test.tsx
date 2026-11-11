import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SceneStore } from '../../tabletop/state/SceneStore';
import { ScenePersistence } from '../../tabletop/state/ScenePersistence';
import { createDemoScene } from '../../tabletop/state/demoScene';
import { historyEntry } from '../../tabletop/state/SceneHistory';
import { api } from '../../api/workspace';
import { ApiError } from '../../api/client';
import { reduceEvent } from '../../realtime/protocol';
import { EncounterPanel } from './EncounterPanel';
import { assignMembers, type PreparedEncounter } from './model';

afterEach(() => vi.restoreAllMocks());
function fixture() {
    const scene = { ...createDemoScene(), id: '7', revision: 1 };
    const encounter: PreparedEncounter = {
        id: '9a223f80-6f42-4246-a4ec-d504ef97c35a',
        name: 'Засада',
        status: 'draft',
        groups: [
            { id: 'main', name: 'Основная', tokenIds: [scene.tokens[0].id] },
            { id: 'reserve', name: 'Резерв', tokenIds: [scene.tokens[1].id] },
        ],
    };
    scene.encounters = [encounter];
    const store = new SceneStore(scene);
    const persistence = new ScenePersistence(store, '7');
    store.setEntityAuthoring(true);
    return { scene, encounter, store, queue: persistence.queue };
}
it('assigns each instance once and excludes it without removing scene entities', () => {
    const { encounter, scene } = fixture();
    const moved = assignMembers(encounter, [scene.tokens[0].id], 'reserve');
    expect(moved.groups[0].tokenIds).toEqual([]);
    expect(moved.groups[1].tokenIds).toContain(scene.tokens[0].id);
    expect(
        assignMembers(moved, [scene.tokens[0].id], '').groups.flatMap((g) => g.tokenIds),
    ).not.toContain(scene.tokens[0].id);
    expect(scene.tokens.length).toBeGreaterThan(1);
});
it('selects composition using PREP02 token selection, without props', () => {
    const { store, encounter } = fixture();
    store.selectEncounter(encounter.id);
    expect(store.selection()).toEqual({
        tokenIds: encounter.groups.flatMap((g) => g.tokenIds),
        propIds: [],
    });
    expect(store.getSnapshot().scene.encounters).toEqual([encounter]);
});
it('retries an ambiguous write with one UUID and records the server-acknowledged history', async () => {
    const { store, queue, encounter } = fixture();
    const next = { ...encounter, name: 'Новая засада' };
    const send = vi
        .spyOn(api, 'encounter')
        .mockRejectedValueOnce(new ApiError('Нет связи', 0))
        .mockResolvedValue({ revision: 2, encounters: [next] });
    store.encounterCommand({ id: encounter.id, expected: encounter, value: next });
    await expect(queue.flush()).rejects.toThrow('Нет связи');
    expect(store.getSnapshot().scene.encounters).toEqual([encounter]);
    queue.retry();
    await queue.flush();
    expect(send.mock.calls[0][2]).toBe(send.mock.calls[1][2]);
    expect(store.getSnapshot().scene.encounters).toEqual([next]);
    expect(store.history!.getSnapshot().undo).toBe('Подготовка столкновения');
});
it('reconciles terminal membership conflicts and leaves SaveQueue usable', async () => {
    const { store, queue, encounter, scene } = fixture();
    vi.spyOn(api, 'encounter').mockRejectedValue(new ApiError('Состав изменился', 409));
    vi.spyOn(api, 'snapshot').mockResolvedValue({ ...scene, revision: 2, encounters: [] });
    store.encounterCommand({ id: encounter.id, expected: encounter, value: null });
    await queue.flush();
    expect(queue.getSnapshot().status).toBe('saved');
    expect(store.getSnapshot().scene.encounters).toEqual([]);
    expect(store.getSnapshot().editorNotice).toContain('Состав изменился');
});
it('applies incremental realtime upserts/removals and skips stale events', () => {
    const { scene, encounter } = fixture();
    const event = {
        type: 'encounter.changed',
        sceneId: '7',
        revision: 2,
        mutationId: 'remote',
        payload: { encounters: [{ ...encounter, name: 'Смена плана' }] },
    };
    const updated = reduceEvent(scene, event);
    expect(updated).not.toBe('gap');
    if (updated === 'gap') return;
    expect(updated.encounters?.[0].name).toBe('Смена плана');
    expect(reduceEvent(updated, event)).toBe(updated);
    const removed = reduceEvent(updated, {
        ...event,
        revision: 3,
        payload: { deletedEncounterId: encounter.id },
    });
    expect(removed !== 'gap' && removed.encounters).toEqual([]);
    expect(reduceEvent(scene, { ...event, revision: 4 })).toBe('gap');
});
it('history retains exact composition, including reserves, for safe create/delete inverses', () => {
    const { scene, encounter } = fixture();
    const command = {
        type: 'encounter' as const,
        command: { id: encounter.id, expected: encounter, value: null },
    };
    expect(
        historyEntry(command, scene, { revision: 2, deletedEncounterId: encounter.id })?.changes[0],
    ).toEqual({
        kind: 'encounter',
        id: encounter.id,
        expected: { encounter: null },
        value: { encounter },
    });
});
it('renders compact preparation cards and groups without combat runtime controls', () => {
    const { store, queue, encounter } = fixture();
    const list = renderToStaticMarkup(
        <EncounterPanel store={store} queue={queue} onClose={() => {}} onPlace={() => {}} />,
    );
    expect(list).toContain('Засада');
    expect(list).toContain('Черновик');
    expect(list).toContain('резерв 1');
    store.selectEncounter(encounter.id);
    const detail = renderToStaticMarkup(
        <EncounterPanel store={store} queue={queue} onClose={() => {}} onPlace={() => {}} />,
    );
    expect(detail).toContain('NPC Library');
    expect(detail).toContain('Скрыть резерв');
    expect(detail).toContain('Исключить');
    expect(detail).not.toContain('Бросить инициативу');
});
