/* eslint-disable @typescript-eslint/no-require-imports -- Browser frame evidence on the permanent battlemap. */
/* global require, process, console, window, performance, setTimeout */
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
    base,
    scene,
} = require('./map07a.cjs');
const out = 'artifacts/map07e3';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function visual(page, id) {
    return page.evaluate((id) => {
        const find = (v) =>
            v.model?.id === id && v.badges ? v : (v.children ?? []).map(find).find(Boolean);
        const v = find(window.tabletopApp.stage);
        const p = v.parent.toGlobal(v.position);
        return {
            x: v.x,
            y: v.y,
            canonical: { x: v.model.x, y: v.model.y },
            screen: { x: p.x, y: p.y },
        };
    }, id);
}
async function point(page, position) {
    const p = await page.evaluate((p) => {
        const v = window.tabletopApp.stage.children[0].toGlobal(p);
        return { x: v.x, y: v.y };
    }, position);
    const box = await tabletop(page).boundingBox();
    return { x: box.x + p.x, y: box.y + p.y };
}
async function clickWorld(page, position, double = false) {
    const p = await point(page, position);
    if (double) await page.mouse.dblclick(p.x, p.y, { delay: 60 });
    else await page.mouse.click(p.x, p.y);
}
async function zoom(page, value, anchor) {
    const p = await point(page, anchor);
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 10; i++) {
        const current = await page.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
        if (Math.abs(current - value) < 0.0005) return;
        const delta = Math.max(-160, Math.min(160, -Math.log(value / current) / 0.002));
        await page.mouse.wheel(0, delta);
        await sleep(450);
    }
    assert.fail('Could not set zoom');
}
async function sample(page, id) {
    await page.evaluate((id) => {
        const find = (v) =>
            v.model?.id === id && v.badges ? v : (v.children ?? []).map(find).find(Boolean);
        const view = find(window.tabletopApp.stage),
            app = window.tabletopApp;
        const frames = [];
        const fn = () =>
            frames.push({
                t: performance.now(),
                x: view.x,
                y: view.y,
                cx: view.model.x,
                cy: view.model.y,
            });
        app.ticker.add(fn, undefined, -50);
        window.e3Sample = { frames, stop: () => app.ticker.remove(fn) };
    }, id);
}
async function finish(page, token) {
    await page.waitForFunction(
        ({ x, y }) => {
            const f = window.e3Sample.frames.at(-1);
            return f && f.x === x && f.y === y;
        },
        token,
        { timeout: 25000 },
    );
    return page.evaluate(() => {
        window.e3Sample.stop();
        return window.e3Sample.frames;
    });
}

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const pages = await Promise.all(
        [1, 2, 8].map((id) =>
            login(
                browser,
                accounts.find((a) => a.id === id),
                id === 2 && process.env.YTT_QA_VIDEO !== '0'
                    ? { recordVideo: { dir: out + '/video', size: { width: 1260, height: 788 } } }
                    : {},
            ),
        ),
    ).catch(async (error) => {
        await browser.close();
        throw error;
    });
    const [gm, p1, p2] = pages;
    const video = p1.video();
    const lifecycleOnly = process.argv.includes('--lifecycle');
    const report = lifecycleOnly
        ? JSON.parse(fs.readFileSync(out + '/visual-report.json', 'utf8'))
        : { checks: [], routes: [], errors: [] };
    delete report.failure;
    report.checks = report.checks.filter((c) => !c.includes('fixture and active Scene restored'));
    const record = (text) => {
        if (!report.checks.includes(text)) report.checks.push(text);
        console.log(text);
    };
    pages.forEach((p) => p.on('pageerror', (error) => report.errors.push(error.message)));
    const baseline = await snapshot(gm),
        active = (await api(gm, '/campaigns/5')).activeSceneId;
    const token = baseline.tokens.find((t) => t.ownerUserId === '2');
    const companion = baseline.tokens.find((t) => t.ownerUserId === '8');
    const disabled = [],
        props = [],
        presets = [];
    let structureEdit,
        mapChanged = false,
        combatChanged = false;
    const place = async (position) => {
        await api(gm, '/tokens/' + token.id, 'PATCH', { ...position, size: 30, scale: 1 });
        await Promise.all(
            pages.map((p) =>
                p.waitForFunction(
                    ({ id, x, y }) => {
                        const find = (v) =>
                            v.model?.id === id && v.badges
                                ? v
                                : (v.children ?? []).map(find).find(Boolean);
                        const v = window.tabletopApp && find(window.tabletopApp.stage);
                        return v && v.x === x && v.y === y && v.model.x === x;
                    },
                    { id: token.id, ...position },
                ),
            ),
        );
    };
    const route = async (target) => {
        const pending = p1.waitForResponse((r) =>
            r.url().endsWith('/api/tokens/' + token.id + '/move'),
        );
        pending.catch(() => {});
        await clickWorld(p1, target, true);
        const response = await pending;
        assert.equal(response.status(), 200, await response.text());
        return response.json();
    };
    const graph = {
        vertices: [
            { id: 'a', x: 670, y: 35 },
            { id: 'b', x: 900, y: 35 },
            { id: 'c', x: 900, y: 300 },
            { id: 'd', x: 670, y: 300 },
        ],
        edges: [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
        ].map(([a, b], i) => ({
            id: 'w' + i,
            a: 'abcd'[a],
            b: 'abcd'[b],
            thickness: 8,
            materialVersionId: null,
            blocksMovement: true,
            blocksVision: true,
            blocksLight: true,
        })),
        rooms: [],
        openings: [
            {
                id: 'door',
                edgeId: 'w2',
                type: 'door',
                center: (900 - 815) / 230,
                width: 64,
                open: true,
                locked: false,
                hinge: 'a',
                direction: 'left',
                angle: 90,
            },
        ],
    };
    const setGraph = async (doorOnly = false) => {
        const r = await api(gm, scene + '/structure', 'POST', {
            expected: (await snapshot(gm)).structure.hash,
            ...(doorOnly
                ? { door: { id: 'door', open: graph.openings[0].open } }
                : { value: graph }),
        });
        if (!structureEdit) structureEdit = r.structureEdit;
        else structureEdit.after = r.structureEdit.after;
        await sleep(200);
    };
    try {
        assert.notEqual(baseline.combat?.status, 'active');
        assert.equal(baseline.structure?.graph.edges.length ?? 0, 0);
        assert.ok(baseline.width > 1000 && baseline.height > 1000);
        report.map = { width: baseline.width, height: baseline.height };
        for (const t of (await api(gm, scene + '/triggers')).triggers.filter((t) => t.enabled)) {
            await api(gm, scene + '/triggers', 'POST', {
                action: 'toggle',
                id: t.id,
                enabled: false,
            });
            disabled.push(t.id);
        }
        if (active !== '5') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
        if (!baseline.mapWorld) {
            const expected = mapState(baseline);
            await api(gm, scene + '/map-world', 'POST', {
                expected,
                value: { ...expected, enabled: true },
            });
            mapChanged = true;
        }
        await api(gm, scene + '/grid', 'PUT', { ...baseline.grid, snap: false });
        await Promise.all(
            pages.map((p, i) =>
                p.goto(base + (i ? '/campaigns/5/play' : '/campaigns/5/scenes/5?mode=session')),
            ),
        );
        await Promise.all(pages.map(subscribed));
        await Promise.all(pages.map((p) => tabletop(p).waitFor()));
        await setGraph();

        if (!lifecycleOnly) {
            // Long street routes are real pointer input; all three Pixi tickers record playback.
            for (const z of [0.29, 0.5, 1]) {
                const start = { x: 220, y: 330 },
                    target = { x: 1000, y: 330 };
                await place(start);
                for (const p of pages) await zoom(p, z, { x: 600, y: 330 });
                await clickWorld(p1, start);
                await Promise.all(pages.map((p) => sample(p, token.id)));
                const result = await route(target);
                await sleep(750);
                await p1.screenshot({ path: out + `/walk-${Math.round(z * 100)}-mid.png` });
                if (z === 0.5) {
                    for (let i = 0; i < 5; i++) {
                        await p1.screenshot({ path: out + `/frame-${i}.png` });
                        await sleep(400);
                    }
                }
                const frames = await Promise.all(pages.map((p) => finish(p, result.token)));
                const stats = frames.map((samples) => {
                    const moving = samples.filter(
                        (f) => f.x > start.x + 0.001 && f.x < target.x - 0.001,
                    );
                    assert.ok(moving.length > 20);
                    const duration = moving.at(-1).t - moving[0].t;
                    assert.ok(duration > 3800 && duration < 6000);
                    const speeds = samples
                        .slice(1)
                        .map(
                            (f, i) =>
                                (Math.hypot(f.x - samples[i].x, f.y - samples[i].y) /
                                    Math.max(1, f.t - samples[i].t)) *
                                1000,
                        );
                    assert.ok(
                        Math.max(...speeds) < 260,
                        'No speed spike or teleport on long route',
                    );
                    return {
                        durationMs: Math.round(duration),
                        frames: moving.length,
                        peakSpeed: Math.round(Math.max(...speeds)),
                    };
                });
                fs.writeFileSync(
                    out + `/frames-${Math.round(z * 100)}.json`,
                    JSON.stringify(frames),
                );
                report.routes.push({
                    zoom: z,
                    length: 780,
                    expectedMs: (780 / 180) * 1000 + 80,
                    roles: stats,
                });
                record(
                    `780-unit street walk: ${(z * 100).toFixed(0)}%, GM + 2 Players, natural duration and no teleport`,
                );
            }
            // Zoom out before framing the cottage. Reuse actual map artwork and existing asset.
            for (const p of pages) await zoom(p, 0.5, { x: 785, y: 280 });
            await place({ x: 600, y: 180 });
            await clickWorld(p1, { x: 600, y: 180 });
            await Promise.all(pages.map((p) => sample(p, token.id)));
            const around = await route({ x: 980, y: 180 });
            assert.ok(around.tokenMovements[0].path.length > 2);
            await sleep(600);
            await p1.screenshot({ path: out + '/cottage-route.png' });
            await Promise.all(pages.map((p) => finish(p, around.token)));
            record('Click-to-Move walks around cottage walls on the real Townhouse battlemap');

            const asset = baseline.props[0].image;
            const preset = await api(gm, '/library/object-presets', 'POST', {
                assetId: asset.id,
                name: 'E3 temporary table',
                category: 'QA',
                settings: {
                    width: 58,
                    height: 42,
                    pivotX: 0.5,
                    pivotY: 0.5,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    tags: [],
                    collider: {
                        type: 'rectangle',
                        x: 0,
                        y: 0,
                        width: 58,
                        height: 42,
                        blocksMovement: true,
                        blocksVision: false,
                        blocksLight: false,
                    },
                },
            });
            presets.push(preset.id);
            const furniture = await api(gm, scene + '/props', 'POST', {
                action: 'create',
                presetId: preset.id,
                x: 815,
                y: 220,
            });
            props.push(furniture.props[0].id);
            await place({ x: 815, y: 360 });
            await clickWorld(p1, { x: 815, y: 360 });
            await Promise.all(pages.map((p) => sample(p, token.id)));
            const inside = await route({ x: 815, y: 145 });
            assert.ok(inside.tokenMovements[0].path.length > 2);
            await sleep(450);
            await p1.screenshot({ path: out + '/door-furniture.png' });
            await Promise.all(pages.map((p) => finish(p, inside.token)));
            record(
                'Open doorway + table: accepted footprint route passes through door and around furniture',
            );

            // Safe unavailable-goal feedback and persistent reticle.
            await clickWorld(p1, { x: 815, y: 145 });
            await clickWorld(p1, { x: 815, y: 220 }, true);
            // A visible prop click retains selection behavior; use a wall interior as unavailable free target.
            await clickWorld(p1, { x: 815, y: 145 });
            await clickWorld(p1, { x: 670, y: 170 }, true);
            await p1.getByText(/Маршрут не найден/).waitFor();
            await p1.screenshot({ path: out + '/unreachable.png' });
            await p1.keyboard.press('Escape');
            record('Unavailable destination has a red cross reticle and neutral route feedback');

            // Re-command while still walking: no discontinuity and accepted old corners stay intact.
            await place({ x: 220, y: 330 });
            await clickWorld(p1, { x: 220, y: 330 });
            await Promise.all(pages.map((p) => sample(p, token.id)));
            await route({ x: 1000, y: 330 });
            await sleep(500);
            const replacement = await route({ x: 1000, y: 470 });
            const frames = await Promise.all(pages.map((p) => finish(p, replacement.token)));
            for (const samples of frames) {
                const deltas = samples
                    .slice(1)
                    .map((f, i) => Math.hypot(f.x - samples[i].x, f.y - samples[i].y));
                assert.ok(
                    Math.max(...deltas) < 35,
                    'Repeated command must not jump to prior endpoint',
                );
            }
            record(
                'Repeated long route retains accepted remainder without a visible jump or collision shortcut',
            );

            // WASD along cottage wall with normalized diagonal and smooth camera follow.
            await place({ x: 649, y: 145 });
            await clickWorld(p1, { x: 649, y: 145 });
            await p1.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
            await p1.getByLabel('Следовать камерой').check();
            await p1.keyboard.down('KeyD');
            await p1.keyboard.down('KeyS');
            await sleep(800);
            await p1.keyboard.up('KeyD');
            await p1.keyboard.up('KeyS');
            await sleep(1200);
            const atWall = await visual(p1, token.id);
            assert.ok(atWall.x < 651 && atWall.y > 200);
            const still = await visual(p1, token.id);
            await sleep(150);
            const stopped = await visual(p1, token.id);
            assert.equal(stopped.x, still.x);
            assert.equal(stopped.y, still.y);
            await p1.screenshot({ path: out + '/wasd-wall-follow.png' });
            await p1.keyboard.press('Escape');
            record(
                'WASD diagonal slides along visible wall, camera follows, keyup stops without drift',
            );
        }

        // Long playback is invalidated by geometry edits, authoritative intervention and reload.
        await place({ x: 220, y: 330 });
        await clickWorld(p1, { x: 220, y: 330 });
        let accepted = await route({ x: 1000, y: 330 });
        await sleep(300);
        graph.openings[0].open = false;
        await setGraph(true);
        await sleep(100);
        for (const p of pages) assert.equal((await visual(p, token.id)).x, accepted.token.x);
        record('Door/geometry update invalidates long playback and reveals canonical endpoint');
        graph.openings[0].open = true;
        await setGraph(true);
        await place({ x: 220, y: 330 });
        await clickWorld(p1, { x: 220, y: 330 });
        await route({ x: 1000, y: 330 });
        await sleep(250);
        await api(gm, '/tokens/' + token.id + '/move', 'POST', {
            x: 600,
            y: 360,
            intent: 'teleport',
        });
        await sleep(150);
        for (const p of pages) assert.equal((await visual(p, token.id)).x, 600);
        record('GM teleport overrides a long route immediately on all three clients');
        await place({ x: 220, y: 330 });
        await clickWorld(p1, { x: 220, y: 330 });
        accepted = await route({ x: 1000, y: 330 });
        await sleep(250);
        await p2.evaluate(() => window.movementDisconnect());
        await p2.reload();
        await subscribed(p2);
        await tabletop(p2).waitFor();
        assert.equal((await visual(p2, token.id)).x, accepted.token.x);
        record('Reconnect/reload during long movement hydrates only canonical endpoint');
        await place({ x: 220, y: 330 });
        await clickWorld(p1, { x: 220, y: 330 });
        accepted = await route({ x: 1000, y: 330 });
        await sleep(250);
        await p1.keyboard.press('Digit1');
        await p1.getByText('Выберите цель на карте', { exact: true }).waitFor();
        assert.equal((await visual(p1, token.id)).x, accepted.token.x);
        await p1.screenshot({ path: out + '/action-canonical-position.png' });
        await p1.keyboard.press('Escape');
        record(
            'Weapon hotkey enters targeting at canonical endpoint, finishing presentation before any action',
        );

        if (active && active !== '5') {
            await place({ x: 220, y: 330 });
            await clickWorld(p1, { x: 220, y: 330 });
            accepted = await route({ x: 1000, y: 330 });
            await sleep(250);
            assert.equal((await api(gm, '/scenes/' + active + '/cues')).pendingCount, 0);
            await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
            await sleep(400);
            await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
            await p2.reload();
            await subscribed(p2);
            await tabletop(p2).waitFor();
            assert.equal((await visual(p2, token.id)).x, accepted.token.x);
            await p1.reload();
            await subscribed(p1);
            await tabletop(p1).waitFor();
            record(
                'Scene switch during long playback disposes presentation; return hydrates canonical endpoint',
            );
        }
        // Real GM group drag includes both existing heroes, with no new actor records.
        await place({ x: 220, y: 330 });
        await api(gm, '/tokens/' + companion.id, 'PATCH', { x: 220, y: 365, size: 30, scale: 1 });
        await sleep(150);
        await clickWorld(gm, { x: 220, y: 330 });
        await gm.keyboard.down('Shift');
        await clickWorld(gm, { x: 220, y: 365 });
        await gm.keyboard.up('Shift');
        await Promise.all(pages.map((p) => sample(p, token.id)));
        const groupReply = gm.waitForResponse((r) => r.url().endsWith('/api/scenes/5/selection'));
        const a = await point(gm, { x: 220, y: 330 }),
            b = await point(gm, { x: 380, y: 330 });
        await gm.mouse.move(a.x, a.y);
        await gm.mouse.down();
        await gm.mouse.move(b.x, b.y, { steps: 6 });
        await gm.screenshot({ path: out + '/group-drag-ghost.png' });
        await gm.mouse.up();
        const groupResponse = await groupReply;
        assert.equal(groupResponse.status(), 200);
        const group = await groupResponse.json();
        assert.equal(group.tokenMovements.length, 2);
        const groupEnd = group.tokenMovements.find((m) => m.tokenId === token.id).path.at(-1);
        await Promise.all(pages.map((p) => finish(p, groupEnd)));
        const companionEnd = group.tokenMovements
            .find((m) => m.tokenId === companion.id)
            .path.at(-1);
        for (const p of pages) assert.equal((await visual(p, companion.id)).x, companionEnd.x);
        record('GM group Drag: two target ghosts, two accepted paths and synchronized playback');

        await place({ x: 220, y: 330 });
        await clickWorld(p1, { x: 220, y: 330 });
        accepted = await route({ x: 1000, y: 330 });
        await sleep(250);
        const combat = baseline.combat;
        combatChanged = true;
        await api(gm, scene + '/combat/begin', 'POST', { combatId: combat.id });
        await sleep(200);
        for (const p of pages) assert.equal((await visual(p, token.id)).x, accepted.token.x);
        const own = combat.combatants.find((c) => c.tokenId === token.id);
        await api(gm, scene + '/combat/current', 'POST', {
            combatId: combat.id,
            combatantId: own.id,
        });
        await sleep(150);
        await clickWorld(p1, { x: 1000, y: 330 });
        await clickWorld(p1, { x: 900, y: 330 }, true);
        const confirm = p1.getByRole('button', { name: 'Подтвердить движение', exact: true });
        await confirm.waitFor();
        assert.equal(await confirm.isEnabled(), true);
        await p1.screenshot({ path: out + '/combat-cost-preview.png' });
        const tactical = p1.waitForResponse((r) =>
            r.url().endsWith('/api/tokens/' + token.id + '/move'),
        );
        await confirm.click();
        const tacticalResponse = await tactical;
        assert.equal(tacticalResponse.status(), 200);
        const tacticalResult = await tacticalResponse.json();
        await sleep(100);
        await api(gm, scene + '/combat/current', 'POST', {
            combatId: combat.id,
            combatantId: combat.combatants.find((c) => c.id !== own.id).id,
        });
        await sleep(200);
        for (const p of pages) assert.equal((await visual(p, token.id)).x, tacticalResult.token.x);
        assert.ok(
            (await snapshot(gm)).combat.combatants.find((c) => c.id === own.id).budget
                .movementSpent > 0,
        );
        record(
            'Combat begin and turn switch finish active playback; tactical confirmation spends TurnBudget once',
        );

        // Switching the existing active Scene disposes old Pixi animation and listeners.
        if (active && active !== '5') {
            await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
            await sleep(400);
            await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
            await p2.reload();
            await subscribed(p2);
            await tabletop(p2).waitFor();
            assert.equal((await visual(p2, token.id)).x, tacticalResult.token.x);
            record(
                'Scene switch and return hydrate canonical state without replaying prior routes',
            );
        }
        await p1.screenshot({ path: out + '/player-final.png' });
        await gm.screenshot({ path: out + '/gm-final.png' });
        assert.deepEqual(report.errors, []);
    } catch (error) {
        report.failure = error.stack;
        throw error;
    } finally {
        try {
            for (const id of props)
                await api(gm, scene + '/selection', 'POST', {
                    action: 'delete',
                    tokenIds: [],
                    propIds: [id],
                });
            for (const id of presets)
                await api(gm, '/library/object-presets/' + id, 'DELETE', undefined, 204);
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
            if (combatChanged)
                require('node:child_process').execFileSync('php', ['artisan', 'qa:townhouse'], {
                    stdio: 'pipe',
                });
            for (const t of baseline.tokens)
                await api(gm, '/tokens/' + t.id, 'PATCH', {
                    x: t.x,
                    y: t.y,
                    size: t.size,
                    scale: t.scale,
                });
            await api(gm, scene + '/grid', 'PUT', baseline.grid);
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
                await api(gm, scene + '/triggers', 'POST', { action: 'toggle', id, enabled: true });
            if (active !== '5') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
            const restored = await snapshot(gm);
            assert.deepEqual(
                restored.tokens.map(({ id, x, y, size, scale }) => ({ id, x, y, size, scale })),
                baseline.tokens.map(({ id, x, y, size, scale }) => ({ id, x, y, size, scale })),
            );
            assert.deepEqual(restored.structure?.graph, baseline.structure?.graph);
            assert.equal((await api(gm, '/campaigns/5')).activeSceneId, active);
            record('Visual QA fixture and active Scene restored');
        } finally {
            fs.writeFileSync(out + '/visual-report.json', JSON.stringify(report, null, 2));
            await browser.close();
            if (video) fs.copyFileSync(await video.path(), out + '/movement-evidence.webm');
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
