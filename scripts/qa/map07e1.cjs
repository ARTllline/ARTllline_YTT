/* eslint-disable @typescript-eslint/no-require-imports -- Native permanent-fixture browser QA. */
/* global require, process, console, window, fetch */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const {
    api,
    login,
    snapshot,
    tabletop,
    mapState,
    subscribed,
    sampleToken,
    finishSample,
    base,
    scene,
} = require('./map07a.cjs');
const out = 'artifacts/map07e1';
fs.mkdirSync(out, { recursive: true });

async function point(page, tokenId, position) {
    const p = await page.evaluate(
        ({ tokenId, position }) => {
            const find = (v) =>
                v.model?.id === tokenId && v.badges
                    ? v
                    : (v.children ?? []).map(find).find(Boolean);
            const v = find(window.tabletopApp.stage);
            const p = v.parent.toGlobal(position);
            return { x: p.x, y: p.y };
        },
        { tokenId, position },
    );
    const box = await tabletop(page).boundingBox();
    return { x: box.x + p.x, y: box.y + p.y };
}
async function synced(pages, token) {
    await Promise.all(
        pages.map((page) =>
            page.waitForFunction(({ id, x, y }) => {
                const find = (v) =>
                    v.model?.id === id && v.badges ? v : (v.children ?? []).map(find).find(Boolean);
                const v = window.tabletopApp && find(window.tabletopApp.stage);
                return (
                    v &&
                    v.model.x === x &&
                    v.model.y === y &&
                    Math.abs(v.x - x) < 0.01 &&
                    Math.abs(v.y - y) < 0.01
                );
            }, token),
        ),
    );
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const report = { checks: [], errors: [] };
    const regions = [],
        triggers = [],
        cues = [],
        disabled = [];
    let gm,
        pages,
        baseline,
        token,
        active,
        structureEdit,
        mapChanged = false;
    const record = (text) => {
        report.checks.push(text);
        console.log(text);
    };
    try {
        pages = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    browser,
                    accounts.find((a) => a.id === id),
                ),
            ),
        );
        [gm] = pages;
        const [, player, second] = pages;
        pages.forEach((p) => p.on('pageerror', (e) => report.errors.push(e.message)));
        active = (await api(gm, '/campaigns/5')).activeSceneId;
        if (active && active !== '5') {
            assert.equal(
                (await api(gm, '/scenes/' + active + '/cues')).pendingCount,
                0,
                'Do not interrupt active user Cues',
            );
        }
        const old = await api(gm, scene + '/triggers');
        for (const t of old.triggers.filter((t) => t.enabled)) {
            await api(gm, scene + '/triggers', 'POST', {
                action: 'toggle',
                id: t.id,
                enabled: false,
            });
            disabled.push(t.id);
        }
        const runs = await api(gm, scene + '/cues');
        assert.equal(runs.pendingCount, 0, 'Do not interfere with pending user Cues');
        if (active !== '5') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
        baseline = await snapshot(gm);
        assert.notEqual(baseline.combat?.status, 'active');
        assert.equal(baseline.structure?.graph.edges.length ?? 0, 0);
        token = baseline.tokens.find((t) => t.ownerUserId === '2');
        assert.ok(token);
        if (!baseline.mapWorld) {
            const expected = mapState(baseline);
            await api(gm, scene + '/map-world', 'POST', {
                expected,
                value: { ...expected, enabled: true },
            });
            mapChanged = true;
        }
        await api(gm, scene + '/grid', 'PUT', { ...baseline.grid, snap: false });
        const x = Math.round(baseline.width / 2);
        const y = [0.15, 0.3, 0.4, 0.2, 0.55, 0.65, 0.75]
            .map((f) => Math.round(baseline.height * f))
            .find((y) =>
                baseline.tokens
                    .filter((t) => t.id !== token.id)
                    .every(
                        (t) =>
                            Math.hypot(t.x - Math.max(x - 240, Math.min(t.x, x + 240)), t.y - y) >
                            (t.size * t.scale) / 2 + 55,
                    ),
            );
        assert.ok(y, 'Need an unoccupied fixture corridor');
        const left = { x: x - 220, y },
            right = { x: x + 220, y };
        const url = '/tokens/' + token.id;
        const place = async (position = left, size = 40, scale = 1) => {
            const r = await api(gm, url, 'PATCH', { ...position, size, scale });
            await synced(pages, r.token);
        };
        await api(gm, url, 'PATCH', { ...left, size: 40, scale: 1 });
        await Promise.all([
            gm.goto(base + '/campaigns/5/scenes/5?mode=session'),
            player.goto(base + '/campaigns/5/play'),
            second.goto(base + '/campaigns/5/play'),
        ]);
        await Promise.all(pages.map(subscribed));
        await Promise.all(pages.map((p) => tabletop(p).waitFor()));
        await synced(pages, { ...token, ...left });
        const graph = {
            vertices: [
                { id: 'a', x: x + 90, y: y - 180 },
                { id: 'b', x: x + 90, y: y + 180 },
            ],
            edges: [
                {
                    id: 'wall',
                    a: 'a',
                    b: 'b',
                    thickness: 8,
                    materialVersionId: null,
                    blocksMovement: true,
                    blocksVision: true,
                    blocksLight: true,
                },
            ],
            rooms: [],
            openings: [
                {
                    id: 'door',
                    edgeId: 'wall',
                    type: 'door',
                    center: 0.5,
                    width: 80,
                    open: true,
                    locked: false,
                    hinge: 'a',
                    direction: 'left',
                    angle: 90,
                },
            ],
        };
        const saved = await api(gm, scene + '/structure', 'POST', {
            expected: (await snapshot(gm)).structure.hash,
            value: graph,
        });
        structureEdit = saved.structureEdit;
        // Later region is deliberately authored first; route order must win over ID.
        const definitions = [
            { shape: 'circle', geometry: { x: x - 30, y, radius: 5 } },
            { shape: 'rectangle', geometry: { x: x - 130, y: y - 80, width: 10, height: 160 } },
        ];
        for (const [i, definition] of definitions.entries()) {
            const r = await api(gm, scene + '/regions', 'POST', {
                action: 'create',
                name: 'E1 SECRET ' + i,
                enabled: true,
                ...definition,
            });
            regions.push(r.region.id);
            for (const eventType of ['region.exit', 'region.enter']) {
                const c = await api(gm, scene + '/cues/save', 'POST', {
                    name: `E1 SECRET ${i} ${eventType}`,
                    steps: [{ type: 'wait', config: { duration: 100 } }],
                });
                cues.push(c.cue.id);
                await api(gm, scene + '/triggers', 'POST', {
                    action: 'save',
                    name: 'E1 SECRET RULE',
                    eventType,
                    regionId: r.region.id,
                    cueId: c.cue.id,
                    enabled: true,
                    once: false,
                    cooldownMs: 0,
                    minimumRound: 1,
                    actorFilter: 'token',
                    actorTokenId: token.id,
                });
                const t = (await api(gm, scene + '/triggers')).triggers.at(-1);
                triggers.push(t.id);
            }
        }
        const history = async () =>
            (await api(gm, scene + '/triggers')).history
                .filter((h) => triggers.includes(String(h.trigger_id)))
                .reverse();
        const ordered = [triggers[3], triggers[2], triggers[1], triggers[0]];
        const counts = async () =>
            (await api(gm, scene + '/triggers')).triggers
                .filter((t) => triggers.includes(t.id))
                .map((t) => t.fireCount);
        const actualMove = async (click) => {
            await synced(pages, { ...token, ...left });
            await Promise.all(pages.map((p) => sampleToken(p, token.id)));
            const a = await point(player, token.id, left),
                b = await point(player, token.id, right);
            await player.screenshot({ path: out + '/before-input.png' });
            const pending = player.waitForResponse((r) => r.url().endsWith('/api' + url + '/move'));
            pending.catch(() => {}); // Keep finally reachable if pointer input fails first.
            if (click) {
                await player.mouse.click(a.x, a.y);
                await player.mouse.dblclick(b.x, b.y, { delay: 70 });
            } else {
                await player.mouse.move(a.x, a.y);
                await player.mouse.down();
                await player.mouse.move(b.x, b.y, { steps: 8 });
                await player.mouse.up();
            }
            const response = await pending;
            assert.equal(response.status(), 200, await response.text());
            const result = await response.json();
            const frames = await Promise.all(pages.map((p) => finishSample(p, result.token)));
            frames.forEach((f) => assert.ok(f.some((p) => p.x > left.x + 1 && p.x < right.x - 1)));
            assert.ok(!JSON.stringify(result).includes('SECRET'));
            return { result, request: response.request().postDataJSON() };
        };
        await actualMove(false);
        assert.deepEqual(
            (await history()).map((h) => String(h.trigger_id)),
            ordered,
        );
        record(
            'Real Player drag through two narrow Regions: enter/exit in route order; smooth GM + two Player views',
        );
        await place();
        const beforeClick = (await history()).length;
        const click = await actualMove(true);
        assert.deepEqual(
            (await history()).slice(beforeClick).map((h) => String(h.trigger_id)),
            ordered,
        );
        record('Real Click-to-Move crosses both traps through open doorway');
        const beforeRetry = await counts();
        const retry = await player.evaluate(
            async ({ route, body }) => {
                const { csrf } = await (await fetch('/api/session')).json();
                const r = await fetch(route, {
                    method: 'POST',
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': csrf,
                    },
                    body: JSON.stringify(body),
                });
                return { status: r.status, replay: r.headers.get('Idempotent-Replay') };
            },
            { route: '/api' + url + '/move', body: click.request },
        );
        assert.equal(retry.status, 200);
        assert.equal(retry.replay, 'true');
        assert.deepEqual(await counts(), beforeRetry);
        record('Exact network retry returns existing receipt without executing Cue again');
        await place();
        const beforeWaypoints = (await history()).length;
        const route = await api(player, url + '/move', 'POST', { ...left, waypoints: [right] });
        assert.equal(route.tokenMovements[0].path.length, 3);
        await synced(pages, route.token);
        assert.deepEqual(
            (await history()).slice(beforeWaypoints).map((h) => String(h.trigger_id)),
            [...ordered, triggers[1], triggers[0], triggers[3], triggers[2]],
        );
        record('Accepted waypoint round trip returns to origin and fires both passes');
        const door = await api(gm, scene + '/structure', 'POST', {
            expected: (await snapshot(gm)).structure.hash,
            door: { id: 'door', open: false },
        });
        structureEdit.after = door.structureEdit.after;
        const beforeBlocked = await counts();
        await api(player, url + '/move', 'POST', right, 422);
        assert.deepEqual(await counts(), beforeBlocked);
        assert.equal((await snapshot(player)).tokens.find((t) => t.id === token.id).x, left.x);
        record('Closed doorway rejects route atomically, no trap events');
        const opened = await api(gm, scene + '/structure', 'POST', {
            expected: (await snapshot(gm)).structure.hash,
            door: { id: 'door', open: true },
        });
        structureEdit.after = opened.structureEdit.after;
        // Tiny footprint and narrow circle: one short step has both endpoints outside.
        await place({ x: x - 45, y }, 20, 0.4);
        const beforeWasd = await counts();
        const a = await point(player, token.id, { x: x - 45, y });
        await player.bringToFront();
        await player.mouse.click(a.x, a.y);
        await player.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
        const pendingStep = player.waitForResponse(
            (r) => r.url().endsWith(url + '/control/step') && r.status() === 200,
        );
        await player.keyboard.down('KeyD');
        const firstStep = await pendingStep;
        await player.keyboard.up('KeyD');
        await player.keyboard.press('Escape');
        await firstStep.json();
        await player.waitForTimeout(500);
        const wasd = await counts();
        assert.ok(wasd[1] > beforeWasd[1]);
        assert.ok(wasd[0] > beforeWasd[0]);
        record('Real WASD input enters and exits narrow circle via shared accepted-route pipeline');
        const beforeReload = await counts();
        await second.reload();
        await subscribed(second);
        await synced(
            [second],
            (await snapshot(player)).tokens.find((t) => t.id === token.id),
        );
        assert.deepEqual(await counts(), beforeReload);
        for (const p of [player, second]) {
            const s = await snapshot(p);
            assert.equal(s.regions, undefined);
            assert.equal(s.triggers, undefined);
            const frames = await p.evaluate(() => window.movementFrames.join('\n'));
            assert.ok(!frames.includes('E1 SECRET'));
            await api(p, scene + '/triggers', 'GET', undefined, 403);
        }
        record(
            'Reload/reconnect snapshot does not repeat events; Player snapshots/realtime omit Region/Cue secrets',
        );
        let drained;
        for (let i = 0; i < 80; i++) {
            drained = await api(gm, scene + '/cues');
            assert.ok(
                !drained.runs.some((r) => cues.includes(r.cue_id) && r.status === 'failed'),
                'Queued Cue failed',
            );
            if (drained.pendingCount === 0) break;
            await gm.waitForTimeout(750);
        }
        assert.equal(drained.pendingCount, 0, 'Live Cue worker must drain accepted events');
        assert.ok(drained.runs.some((r) => cues.includes(r.cue_id) && r.status === 'completed'));
        record(
            'Live MySQL Cue worker completes accepted route events without moving the acknowledged endpoint',
        );
        await gm.screenshot({ path: out + '/gm.png' });
        await player.screenshot({ path: out + '/player.png' });
        assert.deepEqual(report.errors, []);
    } finally {
        try {
            if (gm) {
                for (const id of triggers)
                    await api(gm, scene + '/triggers', 'POST', { action: 'delete', id });
                const runs = await api(gm, scene + '/cues');
                for (const run of runs.runs.filter(
                    (r) =>
                        cues.includes(r.cue_id) &&
                        ['queued', 'running', 'failed'].includes(r.status),
                ))
                    await api(gm, scene + '/cues/cancel', 'POST', { runId: run.id });
                for (const id of cues) await api(gm, scene + '/cues/delete', 'POST', { cueId: id });
                for (const id of regions)
                    await api(gm, scene + '/regions', 'POST', { action: 'delete', id });
                if (structureEdit)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '5',
                                expected: structureEdit.after,
                                value: structureEdit.before,
                            },
                        ],
                    });
                if (token)
                    await api(gm, '/tokens/' + token.id, 'PATCH', {
                        x: token.x,
                        y: token.y,
                        size: token.size,
                        scale: token.scale,
                    });
                if (baseline) await api(gm, scene + '/grid', 'PUT', baseline.grid);
                if (mapChanged)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'mapWorld',
                                id: '5',
                                expected: mapState(await snapshot(gm)),
                                value: mapState(baseline),
                            },
                        ],
                    });
                for (const id of disabled)
                    await api(gm, scene + '/triggers', 'POST', {
                        action: 'toggle',
                        id,
                        enabled: true,
                    });
                if (active !== undefined && active !== '5')
                    await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
                if (baseline) {
                    const restored = await snapshot(gm);
                    assert.deepEqual(restored.grid, baseline.grid);
                    assert.deepEqual(restored.structure?.graph, baseline.structure?.graph);
                    assert.deepEqual(
                        restored.tokens.map(({ id, x, y, size, scale }) => ({
                            id,
                            x,
                            y,
                            size,
                            scale,
                        })),
                        baseline.tokens.map(({ id, x, y, size, scale }) => ({
                            id,
                            x,
                            y,
                            size,
                            scale,
                        })),
                    );
                    assert.deepEqual(restored.regions, baseline.regions);
                    assert.equal((await api(gm, '/campaigns/5')).activeSceneId, active);
                    record(
                        'Temporary Regions/Triggers/Cues removed; fixture and original active Scene restored',
                    );
                }
            }
        } finally {
            fs.writeFileSync(out + '/browser-report.json', JSON.stringify(report, null, 2));
            await browser.close();
        }
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
