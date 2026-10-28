import { describe, expect, it } from 'vitest';
import { createDemoScene } from '../tabletop/state/demoScene';
import { reduceEvent, PreviewOrder, type SceneEvent, type MovePreview } from './protocol';
import { SceneStore } from '../tabletop/state/SceneStore';
const scene = () => ({ ...createDemoScene(), id: '1', revision: 10 });
const event = (patch: Partial<SceneEvent> = {}): SceneEvent => ({
    type: 'token.moved',
    sceneId: '1',
    revision: 11,
    mutationId: 'mutation',
    payload: { token: { ...scene().tokens[0], x: 333 } },
    ...patch,
});
describe('authoritative incremental events', () => {
    it('applies exactly the next revision and ignores duplicate, old, and other-scene events', () => {
        const initial = scene();
        const next = reduceEvent(initial, event());
        expect(next).not.toBe('gap');
        if (next === 'gap') return;
        expect(next.tokens[0].x).toBe(333);
        expect(next.revision).toBe(11);
        expect(reduceEvent(next, event())).toBe(next);
        expect(reduceEvent(next, event({ revision: 9 }))).toBe(next);
        expect(reduceEvent(next, event({ sceneId: '2', revision: 12 }))).toBe(next);
    });
    it('requires a snapshot for gaps without partially applying their payload', () => {
        const initial = scene();
        expect(reduceEvent(initial, event({ revision: 12 }))).toBe('gap');
        expect(initial.tokens[0].x).not.toBe(333);
    });
    it('advances hidden no-op revisions, removes hidden tokens and deduplicates revealed tokens', () => {
        const initial = scene();
        const next = reduceEvent(initial, event({ type: 'scene.revision', payload: {} }));
        expect(next).toEqual({ ...initial, revision: 11 });
        const removed = reduceEvent(
            initial,
            event({
                type: 'token.removed',
                payload: { deletedId: initial.tokens[0].id },
            }),
        );
        expect(removed !== 'gap' && removed.tokens.length).toBe(initial.tokens.length - 1);
        const revealed = reduceEvent(initial, event({ type: 'token.created' }));
        expect(revealed !== 'gap' && revealed.tokens.length).toBe(initial.tokens.length);
    });
    it('preserves local selection on reconciliation but clears a removed selected token', () => {
        const store = new SceneStore(scene());
        store.select(scene().tokens[0].id);
        store.reconcile({ ...scene(), revision: 12 });
        expect(store.getSnapshot().selectedIds).toHaveLength(1);
        store.reconcile({ ...scene(), tokens: [] });
        expect(store.getSnapshot().selectedIds).toHaveLength(0);
    });
    it('uses explicit player capability and immediately respects lock/revocation/offline state', () => {
        const initial = scene();
        const id = initial.tokens[0].id;
        const store = new SceneStore(
            { ...initial, tokens: initial.tokens.map((t) => ({ ...t, canMove: true })) },
            'player',
        );
        expect(store.canMove(id)).toBe(true);
        store.setMovementEnabled(false);
        expect(store.canMove(id)).toBe(false);
        store.setMovementEnabled(true);
        store.reconcile(initial);
        expect(store.canMove(id)).toBe(false);
    });
});
describe('ephemeral movement order', () => {
    const preview = (patch: Partial<MovePreview> = {}): MovePreview => ({
        type: 'token.move-preview',
        sceneId: '1',
        tokenId: scene().tokens[0].id,
        baseRevision: 10,
        dragSessionId: 'drag-a',
        sequence: 1,
        x: 123,
        y: 456,
        ...patch,
    });
    it('ignores reordered packets and previews after a committed or cancelled drag', () => {
        const order = new PreviewOrder();
        expect(order.accept(scene(), preview({ sequence: 3 }))).toBe(true);
        expect(order.accept(scene(), preview({ sequence: 2 }))).toBe(false);
        order.finish('drag-a');
        expect(order.accept(scene(), preview({ sequence: 4 }))).toBe(false);
        expect(order.accept(scene(), preview({ dragSessionId: 'drag-b', cancelled: true }))).toBe(
            true,
        );
        expect(order.accept(scene(), preview({ dragSessionId: 'drag-b', sequence: 2 }))).toBe(
            false,
        );
    });
    it('rejects stale revisions, absent tokens, and previous scenes without changing canonical positions', () => {
        const order = new PreviewOrder();
        const initial = scene();
        expect(order.accept(initial, preview({ baseRevision: 9 }))).toBe(false);
        expect(order.accept(initial, preview({ tokenId: 'secret' }))).toBe(false);
        expect(order.accept(initial, preview({ sceneId: 'previous' }))).toBe(false);
        expect(order.accept(initial, preview())).toBe(true);
        expect(initial.tokens[0].x).not.toBe(123);
    });
});
