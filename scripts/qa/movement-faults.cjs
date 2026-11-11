/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, window, fetch, crypto, setTimeout, setInterval, clearInterval, performance */
const assert = require('node:assert/strict');
const { api } = require('./map07a.cjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs inside the motion fixture's backup/restore and independent GM/player contexts. */
async function faultScenario(input, player, gm, id) {
    const mode = input.slice('fault-'.length);
    await player.evaluate((mode) => {
        window.motionInitialUpdate = window.perfRenderer.store.getSnapshot().movementUpdate;
        window.motionDropNext =
            mode === 'timeout' ? 'timeout' : mode === 'drop' || mode === 'cancel-drop';
        window.motionRejectNext = mode === 'reject';
    }, mode);
    await player.keyboard.down('d');
    await player.waitForFunction(() => window.perfRenderer.store.directCommandPending);
    if (mode === 'cancel' || mode === 'cancel-drop') await player.keyboard.press('Escape');
    else if (mode === 'reconnect')
        await player.evaluate(() => {
            window.motionDisconnectAt = performance.now();
            window.motionConnectionLog = [];
            window.motionWatch = setInterval(
                () =>
                    window.motionConnectionLog.push({
                        t: performance.now(),
                        connected: window.perfRenderer.store.spatial.connected,
                        active: !!window.perfRenderer.store.getSnapshot().directControl,
                    }),
                20,
            );
            window.movementDisconnect();
        });
    else if (mode === 'external') await api(gm, '/tokens/' + id, 'PATCH', { x: 590, y: 850 });
    if (mode !== 'external') {
        await player.waitForFunction(() => !window.perfRenderer.store.getSnapshot().directControl);
    }
    await player.keyboard.up('d');
    await player.waitForFunction(() => !window.perfRenderer.store.directCommandPending);
    if (['drop', 'cancel-drop', 'timeout', 'reject', 'reconnect'].includes(mode)) {
        await player.waitForFunction(
            () => {
                const s = window.perfRenderer.store.getSnapshot();
                return (
                    s.movementUpdate !== window.motionInitialUpdate &&
                    s.movementUpdate?.reset &&
                    window.perfRenderer.store.spatial.connected
                );
            },
            undefined,
            { timeout: 30000 },
        );
    }
    await sleep(1400);
    const state = await player.evaluate((id) => {
        clearInterval(window.motionWatch);
        const r = window.perfRenderer,
            s = r.store.getSnapshot(),
            v = r.tokens.views.get(id);
        return {
            canonical: s.scene.tokens.find((t) => t.id === id),
            visual: { x: v.x, y: v.y },
            active: !!s.directControl,
            requests: window.motionRequests.map((r) => ({ status: r.status, url: r.url })),
            connectionLog: window.motionConnectionLog,
            disconnectAt: window.motionDisconnectAt,
            revision: s.scene.revision,
        };
    }, id);
    const server = (await api(gm, '/scenes/10/snapshot')).tokens.find((t) => t.id === id);
    assert.equal(state.active, false, 'fault must stop input');
    assert.equal(state.canonical.x, server.x);
    assert.equal(state.canonical.y, server.y);
    assert.ok(
        Math.hypot(state.visual.x - server.x, state.visual.y - server.y) < 0.003,
        'visual must converge',
    );
    assert.equal(
        state.requests.filter((r) => r.url.endsWith('/step')).length,
        1,
        'no retry or stale input replay',
    );
    if (['drop', 'cancel-drop', 'timeout'].includes(mode))
        assert.ok(server.x > 570, 'lost response actually committed');
    if (mode === 'reject') assert.equal(server.x, 570, 'rejection must not commit');
    if (mode === 'external') assert.equal(server.x, 590, 'external authority must win');
    if (mode === 'drop') {
        const delta = await api(gm, '/tokens/' + id, 'PATCH', { x: server.x, y: server.y });
        await player.waitForFunction(
            (revision) => window.perfRenderer.store.getSnapshot().scene.revision >= revision,
            delta.revision,
        );
    }
    // Explicit fresh input after recovery, using the same existing character.
    await player.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
    await player.keyboard.down('d');
    await sleep(650);
    await player.keyboard.up('d');
    await sleep(1600);
    const recovered = (await api(gm, '/scenes/10/snapshot')).tokens.find((t) => t.id === id);
    assert.ok(recovered.x > server.x + 20, 'explicit fresh input must work after recovery');
    await player.keyboard.press('Escape');
    return {
        mode,
        stopped: true,
        converged: true,
        stepsBeforeRestart: 1,
        restarted: true,
        disconnectStopMs:
            mode === 'reconnect'
                ? state.connectionLog.find((e) => !e.active)?.t - state.disconnectAt
                : undefined,
    };
}
async function receiptScenario(player, gm, id) {
    const before = await api(gm, '/scenes/10/snapshot');
    const token = before.tokens.find((t) => t.id === id);
    const result = await player.evaluate(async (id) => {
        const { csrf } = await (await fetch('/api/session')).json();
        const mutation = crypto.randomUUID();
        const send = async (x) => {
            const response = await fetch('/api/tokens/' + id + '/move', {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrf,
                },
                body: JSON.stringify({ x, y: 830, instant: true, clientMutationId: mutation }),
            });
            return {
                status: response.status,
                replay: response.headers.get('Idempotent-Replay'),
                data: await response.json(),
            };
        };
        // Two overlapping requests exercise the real HTTP/idempotency boundary.
        const pair = await Promise.all([send(590), send(590)]);
        const conflict = await send(600);
        window.receiptReplay = () => send(590);
        return { pair, conflict: conflict.status };
    }, id);
    assert.equal(result.pair[0].status, 200);
    assert.equal(result.pair[1].status, 200);
    // MySQL JSON round-trips doubles with sub-picounit differences in polygons.
    const normalized = (value) =>
        JSON.parse(
            JSON.stringify(value, (_, v) =>
                typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v,
            ),
        );
    assert.deepEqual(normalized(result.pair[0].data), normalized(result.pair[1].data));
    assert.equal(result.pair.filter((r) => r.replay === 'true').length, 1);
    assert.equal(result.conflict, 409);
    const after = await api(gm, '/scenes/10/snapshot');
    assert.equal(after.revision, before.revision + 1, 'Retry must not advance revision twice');
    try {
        await api(gm, '/tokens/' + id, 'PATCH', { isLocked: true });
        const denied = (await player.evaluate(() => window.receiptReplay())).status;
        assert.ok(
            [403, 409].includes(denied),
            'Permission/visibility revision must prevent stale receipt replay',
        );
    } finally {
        await api(gm, '/tokens/' + id, 'PATCH', { isLocked: token.isLocked });
    }
    return { exactlyOnce: true, conflictingPayload: 409, invalidatedReceiptDenied: true };
}
module.exports = { faultScenario, receiptScenario };
