import { afterEach, expect, it, vi } from 'vitest';
import { ClickToMove, routeStep } from './ClickToMove';
import { SceneStore } from '../state/SceneStore';
import { createDemoScene } from '../state/demoScene';
import type { InteractionLayer } from '../layers/InteractionLayer';
import type { Scene } from '../types/scene';

class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
        FakeWorker.instances.push(this);
    }
    deliver(
        path = [
            { x: 50, y: 50 },
            { x: 80, y: 90 },
            { x: 110, y: 90 },
        ],
    ) {
        this.onmessage?.({ data: { status: 'found', path, length: 80 } });
    }
}
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeWorker.instances = [];
});

it.each([false, true])(
    'stops unsent route portions even when the receipt arrives after cancellation (combat=%s)',
    (combat) => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(0);
        const { click, token, store, command } = fixture(combat, 100);
        click.request(token.id, { x: 350, y: 50 });
        FakeWorker.instances[0].deliver([
            { x: 50, y: 50 },
            { x: 350, y: 50 },
        ]);
        if (combat) click.confirm();
        expect(command).toHaveBeenCalledTimes(1);
        expect(command.mock.calls[0][0].position).toEqual({ x: 122, y: 50 });
        click.cancel();
        store.accept(
            {
                revision: 1,
                token: { ...token, x: 122, y: 50 },
                tokenMovements: [
                    {
                        tokenId: token.id,
                        path: [
                            { x: 50, y: 50 },
                            { x: 122, y: 50 },
                        ],
                    },
                ],
            },
            true,
        );
        now.mockReturnValue(5000);
        click.sync(1);
        expect(command).toHaveBeenCalledTimes(1);
        expect(store.getSnapshot().scene.tokens[0].x).toBe(122);
        expect(store.getSnapshot().routePreview).toBeUndefined();
        click.destroy();
    },
);

it('preserves corners when splitting a route and continues only after an accepted step', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    expect(
        routeStep([
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 100 },
        ]),
    ).toEqual({
        step: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 32 },
        ],
        rest: [
            { x: 40, y: 32 },
            { x: 40, y: 100 },
        ],
    });
    const { click, token, store, command } = fixture();
    click.request(token.id, { x: 350, y: 50 });
    FakeWorker.instances[0].deliver([
        { x: 50, y: 50 },
        { x: 350, y: 50 },
    ]);
    now.mockReturnValue(250);
    click.sync(1);
    expect(command).toHaveBeenCalledTimes(1);
    store.accept(
        {
            revision: 1,
            token: { ...token, x: 122, y: 50 },
            tokenMovements: [
                {
                    tokenId: token.id,
                    path: [
                        { x: 50, y: 50 },
                        { x: 122, y: 50 },
                    ],
                },
            ],
        },
        true,
    );
    click.sync(1);
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[1][0].position).toEqual({ x: 194, y: 50 });
    click.destroy();
});
function fixture(combat = false, remaining = 20, ownTurn = true) {
    vi.stubGlobal('Worker', FakeWorker);
    const scene = createDemoScene();
    const token = { ...scene.tokens[0], x: 50, y: 50, canMove: true };
    const store = new SceneStore(
        {
            ...scene,
            grid: { ...scene.grid, size: 60, distancePerCell: 5, snap: false },
            tokens: [token],
            ...(combat
                ? {
                      combat: {
                          status: 'active',
                          combatants: [
                              {
                                  tokenId: token.id,
                                  budget: { ownTurn, movementRemaining: remaining },
                              },
                          ],
                      } as Scene['combat'],
                  }
                : {}),
        },
        'player',
    );
    const command = vi.fn();
    store.bindCommands(command);
    store.select(token.id);
    const overlay = { clear: vi.fn(), showMovement: vi.fn(), showDestination: vi.fn() };
    const click = new ClickToMove(store, overlay as unknown as InteractionLayer);
    return { store, token, command, overlay, click };
}
it('sends exploration through the existing normal movement contract without changing coordinates', () => {
    const { click, token, command, store } = fixture();
    click.request(token.id, { x: 110, y: 90 });
    expect(command).not.toHaveBeenCalled();
    FakeWorker.instances[0].deliver();
    expect(command).toHaveBeenCalledWith(
        expect.objectContaining({
            type: 'move',
            id: token.id,
            position: { x: 102, y: 90 },
            intent: undefined,
            waypoints: [{ x: 80, y: 90 }],
        }),
        expect.anything(),
    );
    expect(store.getSnapshot().scene.tokens[0].x).toBe(50);
    click.destroy();
});

it('keeps a destination marker through search and shows a failed target without sending a command', () => {
    const { click, token, command, store, overlay } = fixture();
    const target = { x: 150, y: 150 };
    click.request(token.id, target);
    click.sync(0.29);
    expect(overlay.showDestination).toHaveBeenLastCalledWith(
        target,
        (token.size * token.scale) / 2,
        0.29,
        false,
    );
    FakeWorker.instances[0].onmessage?.({ data: { status: 'unreachable' } });
    click.sync(0.29);
    expect(overlay.showDestination).toHaveBeenLastCalledWith(
        target,
        (token.size * token.scale) / 2,
        0.29,
        true,
    );
    expect(store.getSnapshot().routePreview?.status).toBe('error');
    expect(command).not.toHaveBeenCalled();
    click.destroy();
});
it('requires explicit combat confirmation and uses the existing movement scale and budget', () => {
    const { click, token, command, store, overlay } = fixture(true);
    click.request(token.id, { x: 110, y: 90 });
    FakeWorker.instances[0].deliver();
    expect(command).not.toHaveBeenCalled();
    expect(store.getSnapshot().routePreview).toMatchObject({
        status: 'ready',
        allowed: true,
        cost: 6.6667,
        remaining: 20,
    });
    click.sync(1);
    expect(overlay.showMovement.mock.calls[0].at(-1)).toHaveLength(3);
    click.confirm();
    click.confirm();
    expect(command).toHaveBeenCalledTimes(1);
    click.destroy();
});

it.each([false, true])(
    'Drag routes commit the complete detour instantly with actual route cost (combat=%s)',
    (combat) => {
        const { click, token, command, store } = fixture(combat, 100);
        const path = [
            { x: 50, y: 50 },
            { x: 50, y: 150 },
            { x: 250, y: 150 },
            { x: 250, y: 50 },
        ];
        click.request(token.id, path.at(-1)!, true);
        FakeWorker.instances[0].onmessage?.({ data: { status: 'found', path, length: 400 } });
        expect(command).toHaveBeenCalledTimes(1);
        expect(command.mock.calls[0][0]).toMatchObject({
            type: 'move',
            position: path.at(-1),
            waypoints: path.slice(1, -1),
            instant: true,
        });
        expect(store.getSnapshot().routePreview?.cost).toBeCloseTo(33.3334);
        click.cancel();
        click.destroy();
    },
);

it('Drag cannot bypass combat cost with a short straight line through an obstacle', () => {
    const { click, token, command, store } = fixture(true, 20);
    const path = [
        { x: 50, y: 50 },
        { x: 50, y: 250 },
        { x: 100, y: 250 },
        { x: 100, y: 50 },
    ];
    click.request(token.id, path.at(-1)!, true);
    FakeWorker.instances[0].onmessage?.({ data: { status: 'found', path, length: 450 } });
    expect(store.getSnapshot().routePreview?.allowed).toBe(false);
    expect(command).not.toHaveBeenCalled();
    click.destroy();
});
it.each([
    [1, true],
    [20, false],
])('cannot auto-spend an invalid combat path (%s, %s)', (remaining, ownTurn) => {
    const { click, token, command, store } = fixture(true, remaining, ownTurn);
    click.request(token.id, { x: 110, y: 90 });
    FakeWorker.instances[0].deliver();
    expect(store.getSnapshot().routePreview?.allowed).toBe(false);
    click.confirm();
    expect(command).not.toHaveBeenCalled();
    click.destroy();
});
it('cancels stale geometry/turn/snapshot results and ignores old Workers after a repeated command', () => {
    const { click, token, command, store } = fixture(true);
    click.request(token.id, { x: 110, y: 90 });
    const first = FakeWorker.instances[0];
    click.request(token.id, { x: 120, y: 90 });
    expect(first.terminate).toHaveBeenCalled();
    first.deliver(); // A late message must not cancel the newer request.
    expect(store.getSnapshot().routePreview?.status).toBe('searching');
    store.reconcile({ ...store.getSnapshot().scene, revision: 3 });
    FakeWorker.instances[1].deliver();
    click.confirm();
    expect(command).not.toHaveBeenCalled();
    expect(store.getSnapshot().routePreview).toBeUndefined();
    click.destroy();
});
it('Escape cancellation stops pending work; ruler, targeting, editor and locked tokens cannot route', () => {
    const { click, token, command, store } = fixture();
    click.request(token.id, { x: 110, y: 90 });
    click.cancel();
    FakeWorker.instances[0].deliver();
    expect(command).not.toHaveBeenCalled();
    store.spatial.setTool('ruler');
    expect(click.eligible(token.id)).toBe(false);
    store.spatial.setTool('select');
    store.abilityTargeting = true;
    expect(click.eligible(token.id)).toBe(false);
    store.abilityTargeting = false;
    store.setMovementEnabled(false);
    expect(click.eligible(token.id)).toBe(false);
    click.destroy();
});

it('waits for an in-flight receipt and plans the latest repeated command from the accepted origin', () => {
    const { click, token, store, command } = fixture();
    click.request(token.id, { x: 110, y: 90 });
    FakeWorker.instances[0].deliver();
    click.request(token.id, { x: 150, y: 90 });
    click.request(token.id, { x: 180, y: 90 });
    expect(command).toHaveBeenCalledTimes(1);
    expect(FakeWorker.instances).toHaveLength(1);
    store.accept(
        {
            revision: 1,
            token: { ...token, x: 110, y: 90 },
            tokenMovements: [
                {
                    tokenId: token.id,
                    path: [
                        { x: 50, y: 50 },
                        { x: 110, y: 90 },
                    ],
                },
            ],
        },
        true,
    );
    click.sync(1);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ start: { x: 110, y: 90 }, target: { x: 180, y: 90 } }),
    );
    FakeWorker.instances[1].deliver([
        { x: 110, y: 90 },
        { x: 180, y: 90 },
    ]);
    expect(command).toHaveBeenCalledTimes(2);
    click.destroy();
});

it('does not retry a deferred destination after rejection/reconnect or changed geometry', () => {
    const { click, token, store, command } = fixture();
    click.request(token.id, { x: 110, y: 90 });
    FakeWorker.instances[0].deliver();
    click.request(token.id, { x: 180, y: 90 });
    store.reconcile({ ...store.getSnapshot().scene });
    click.sync(1);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(command).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().routePreview).toBeUndefined();
    click.destroy();
});

it('can defer returning to the old origin while the previous move is awaiting acceptance', () => {
    const { click, token, store } = fixture();
    click.request(token.id, { x: 110, y: 90 });
    FakeWorker.instances[0].deliver();
    click.request(token.id, { x: 50, y: 50 });
    store.accept(
        {
            revision: 1,
            token: { ...token, x: 110, y: 90 },
            tokenMovements: [
                {
                    tokenId: token.id,
                    path: [
                        { x: 50, y: 50 },
                        { x: 110, y: 90 },
                    ],
                },
            ],
        },
        true,
    );
    click.sync(1);
    expect(FakeWorker.instances[1].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ start: { x: 110, y: 90 }, target: { x: 50, y: 50 } }),
    );
    click.destroy();
});
