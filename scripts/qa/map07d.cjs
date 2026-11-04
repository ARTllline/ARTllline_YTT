/* eslint-disable @typescript-eslint/no-require-imports -- Native permanent-fixture browser QA. */
/* global require, process, console, window, performance, setTimeout, Event, document, crypto, fetch */
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
    sampleToken,
} = require('./map07a.cjs');
const out = 'artifacts/map07d';
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function visual(page, id) {
    return page.evaluate((id) => {
        const find = (v) =>
            v.model?.id === id && v.badges ? v : (v.children ?? []).map(find).find(Boolean);
        const v = find(window.tabletopApp.stage);
        if (!v) return null;
        const p = v.parent.toGlobal(v.position);
        const count = (node) =>
            1 + (node.children ?? []).reduce((sum, child) => sum + count(child), 0);
        return {
            x: v.x,
            y: v.y,
            screen: { x: p.x, y: p.y },
            children: count(window.tabletopApp.stage),
        };
    }, id);
}
async function select(page, id) {
    const p = await visual(page, id),
        box = await tabletop(page).boundingBox();
    await page.mouse.click(box.x + p.screen.x, box.y + p.screen.y);
    await page.getByRole('button', { name: 'Управлять · WASD', exact: true }).waitFor();
}
async function enable(page, id) {
    await page.bringToFront();
    await select(page, id);
    await page.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
    await page.getByRole('button', { name: 'Выйти · Esc', exact: true }).waitFor();
}
async function hold(page, codes, ms) {
    for (const key of codes) await page.keyboard.down(key);
    await sleep(ms);
    for (const key of codes) await page.keyboard.up(key);
    await sleep(1200);
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const report = { checks: [], runs: [], errors: [] };
    let gm,
        baseline,
        pages,
        mapChanged = false,
        structureEdit,
        combatChanged = false;
    const props = [],
        presets = [],
        framesByRole = [new Map(), new Map(), new Map()];
    const record = (s) => {
        report.checks.push(s);
        console.log(s);
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
        const [, p1, p2] = pages;
        pages.forEach((page, index) => {
            page.on('pageerror', (e) => report.errors.push(e.message));
            page.on('websocket', (socket) =>
                socket.on('framereceived', (event) => {
                    try {
                        const outer = JSON.parse(String(event.payload)),
                            data =
                                typeof outer.data === 'string'
                                    ? JSON.parse(outer.data)
                                    : outer.data;
                        if (data?.mutationId)
                            framesByRole[index].set(data.mutationId, performance.now());
                    } catch {
                        /* Pusher control frames have no scene mutation. */
                    }
                }),
            );
        });
        baseline = await snapshot(gm);
        assert.notEqual(baseline.combat?.status, 'active');
        assert.equal(baseline.structure?.graph.edges.length ?? 0, 0);
        const tokens = [2, 8].map((id) =>
            baseline.tokens.find((t) => t.ownerUserId === String(id)),
        );
        assert.ok(tokens.every(Boolean));
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
        const center = { x: Math.round(baseline.width / 2), y: Math.round(baseline.height / 2) };
        const origins = [
            { x: center.x - 200, y: center.y },
            { x: center.x - 200, y: center.y + 160 },
        ];
        async function place(index = 0, point = origins[index]) {
            const result = await api(gm, '/tokens/' + tokens[index].id, 'PATCH', {
                ...point,
                size: 30,
                scale: 1,
            });
            await Promise.all(
                pages.map((p) =>
                    p.waitForFunction(
                        (id) => window.movementFrames.some((f) => f.includes(id)),
                        result.mutationId,
                    ),
                ),
            );
            await sleep(80);
        }
        async function exit(p = p1) {
            if (await p.getByRole('button', { name: 'Выйти · Esc', exact: true }).count())
                await p.keyboard.press('Escape');
        }
        async function setGraph(graph) {
            const s = await snapshot(gm);
            const result = await api(gm, scene + '/structure', 'POST', {
                expected: s.structure.hash,
                value: graph,
            });
            if (!structureEdit) structureEdit = result.structureEdit;
            else structureEdit.after = result.structureEdit.after;
            await Promise.all(
                pages.map((p) =>
                    p.waitForFunction(
                        (id) => window.movementFrames.some((f) => f.includes(id)),
                        result.mutationId,
                    ),
                ),
            );
        }
        await place(0);
        await place(1);
        // Actual moving-command baseline with all three canvases subscribed.
        const baselineSamples = [];
        for (let i = 0; i < 6; i++) {
            const start = performance.now();
            const result = await api(p1, '/tokens/' + tokens[0].id + '/move', 'POST', {
                x: origins[0].x + (i % 2 ? 0 : 12),
                y: origins[0].y,
            });
            const httpMs = performance.now() - start;
            await gm.waitForFunction(
                (id) => window.movementFrames.some((f) => f.includes(id)),
                result.mutationId,
            );
            baselineSamples.push({
                httpMs: +httpMs.toFixed(1),
                observerMs: +(performance.now() - start).toFixed(1),
            });
        }
        report.baseline = baselineSamples;
        await place();
        await p1.evaluate(() => {
            const native = window.fetch.bind(window);
            window.wasdDelay = 0;
            window.wasdTimings = [];
            window.fetch = async (input, init) => {
                const control = String(input).includes('/control/');
                const delay = control ? window.wasdDelay : 0,
                    began = performance.now();
                if (delay) await new Promise((resolve) => setTimeout(resolve, delay / 2));
                init?.signal?.throwIfAborted();
                const response = await native(input, init);
                if (delay) await new Promise((resolve) => setTimeout(resolve, delay / 2));
                init?.signal?.throwIfAborted();
                if (String(input).endsWith('/control/step'))
                    window.wasdTimings.push({
                        ms: Math.round(performance.now() - began),
                        status: response.status,
                    });
                return response;
            };
        });
        for (const extraRtt of [0, 100, 250]) {
            await exit();
            await place();
            const metrics = [],
                starts = new Map();
            let flight = 0,
                maxFlight = 0;
            const listener = (req) => {
                if (req.url().endsWith('/control/step')) {
                    starts.set(req, performance.now());
                    flight++;
                    maxFlight = Math.max(maxFlight, flight);
                }
            };
            const responses = async (response) => {
                if (!response.url().endsWith('/control/step')) return;
                flight--;
                metrics.push({
                    mutationId: response.request().postDataJSON().clientMutationId,
                    at: Date.now(),
                    sentAt: starts.get(response.request()),
                    status: response.status(),
                    ms: Math.round(performance.now() - starts.get(response.request())),
                    bytes: (await response.body()).length,
                    error: response.status() === 200 ? undefined : (await response.json()).message,
                });
            };
            p1.on('request', listener);
            p1.on('response', responses);
            await p1.evaluate((delay) => {
                window.wasdDelay = delay;
                window.wasdTimings = [];
            }, extraRtt);
            await enable(p1, tokens[0].id);
            await Promise.all(pages.map((p) => sampleToken(p, tokens[0].id)));
            const began = Date.now();
            await hold(p1, ['KeyD'], 2200);
            const end = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
            const frames = await Promise.all(
                pages.map((p) =>
                    p.evaluate(() => {
                        window.tokenSample.stop();
                        return window.tokenSample.samples;
                    }),
                ),
            );
            frames.forEach((samples) =>
                assert.ok(
                    samples.some((v) => v.x > origins[0].x + 1 && v.x < end.x - 1),
                    'All three renderers animate',
                ),
            );
            if (end.x <= origins[0].x + 80)
                console.log(
                    JSON.stringify({
                        extraRtt,
                        metrics,
                        end: { x: end.x, y: end.y },
                        active: await p1
                            .getByRole('button', { name: 'Выйти · Esc', exact: true })
                            .count(),
                    }),
                );
            assert.ok(end.x > origins[0].x + 80, 'Holding D moves');
            assert.ok(
                metrics.every((m) => m.status === 200),
                JSON.stringify(metrics),
            );
            assert.equal(maxFlight, 1);
            const commandTimings = await p1.evaluate(() => window.wasdTimings);
            metrics.forEach((metric, i) => {
                metric.commandMs = commandTimings[i]?.ms;
                metric.observerMs = [0, 2].map((role) =>
                    Math.round(framesByRole[role].get(metric.mutationId) - metric.sentAt),
                );
            });
            for (let i = 1; i < metrics.length; i++)
                assert.ok(metrics[i].sentAt - metrics[i - 1].sentAt >= 190);
            const local = await visual(p1, tokens[0].id);
            assert.ok(Math.abs(local.x - end.x) < 0.01, 'Reconciled after keyup');
            report.runs.push({
                extraRtt,
                metrics,
                maxFlight,
                distance: +(end.x - origins[0].x).toFixed(2),
                elapsedMs: Date.now() - began,
                movingFrameCounts: frames.map((v) => new Set(v.map((p) => p.x)).size),
            });
            p1.off('request', listener);
            p1.off('response', responses);
            await p1.evaluate(() => {
                window.wasdDelay = 0;
            });
            record(
                `WASD +${extraRtt} ms RTT: authoritative movement, bounded single flight, three smooth views, keyup convergence`,
            );
        }
        await exit();
        await place();
        await enable(p1, tokens[0].id);
        await hold(p1, ['KeyD', 'KeyS'], 1100);
        const diagonal = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        assert.ok(Math.abs(diagonal.x - origins[0].x - (diagonal.y - origins[0].y)) < 7);
        assert.ok(Math.hypot(diagonal.x - origins[0].x, diagonal.y - origins[0].y) <= 215);
        report.diagonal = {
            dx: diagonal.x - origins[0].x,
            dy: diagonal.y - origins[0].y,
            distance: Math.hypot(diagonal.x - origins[0].x, diagonal.y - origins[0].y),
            holdMs: 1100,
        };
        record('Diagonal input normalized; no per-axis speed bonus');
        await exit();
        await place();
        await enable(p1, tokens[0].id);
        await p1.getByLabel('Следовать камерой').check();
        const beforeFollow = await visual(p1, tokens[0].id);
        await hold(p1, ['KeyD'], 1000);
        const afterFollow = await visual(p1, tokens[0].id);
        assert.ok(afterFollow.x > beforeFollow.x + 50);
        await p1.screenshot({ path: out + '/player-follow.png' });
        const zoomBefore = await p1.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
        const cameraBox = await tabletop(p1).boundingBox();
        await p1.mouse.move(cameraBox.x + cameraBox.width / 2, cameraBox.y + cameraBox.height / 2);
        await p1.mouse.wheel(0, -160);
        await sleep(650);
        const zoomAfter = await p1.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
        assert.ok(
            Math.abs(zoomAfter - zoomBefore * Math.exp(0.32)) < 0.005,
            'Follow preserves smooth wheel zoom',
        );
        report.cameraFollowZoom = { zoomBefore, zoomAfter };
        record('Camera follow enabled; checkbox focus and smooth wheel zoom remain available');
        await p1.keyboard.press('Escape');
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        await place();
        await enable(p1, tokens[0].id);
        await p1.keyboard.down('KeyD');
        await sleep(300);
        await p1.evaluate(() => window.dispatchEvent(new Event('blur')));
        await p1.keyboard.up('KeyD');
        await sleep(900);
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        const stopped = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        await sleep(500);
        assert.equal((await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id).x, stopped.x);
        record('Blur drops held keys; no automatic continuation');
        const wallX = center.x - 80;
        const graph = {
            vertices: [
                { id: 'a', x: wallX, y: center.y - 120 },
                { id: 'b', x: wallX, y: center.y + 120 },
            ],
            edges: [
                {
                    id: 'wall',
                    a: 'a',
                    b: 'b',
                    thickness: 8,
                    blocksMovement: true,
                    blocksVision: true,
                    blocksLight: true,
                    materialVersionId: null,
                },
            ],
            rooms: [],
            openings: [],
        };
        await place();
        await setGraph(graph);
        await enable(p1, tokens[0].id);
        await hold(p1, ['KeyD'], 1800);
        let position = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        assert.ok(position.x < wallX - 19);
        assert.ok(position.x > origins[0].x + 60);
        record('Visible wall stops both prediction and accepted footprint');
        await exit();
        graph.openings = [
            {
                id: 'door',
                edgeId: 'wall',
                type: 'door',
                center: 0.5,
                width: 100,
                open: false,
                locked: false,
                hinge: 'a',
                direction: 'left',
                angle: 90,
            },
        ];
        await place();
        await setGraph(graph);
        await enable(p1, tokens[0].id);
        await hold(p1, ['KeyD'], 1800);
        position = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        assert.ok(position.x < wallX - 19);
        await exit();
        graph.openings[0].open = true;
        await setGraph(graph);
        await place();
        await enable(p1, tokens[0].id);
        await hold(p1, ['KeyD'], 1800);
        position = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        assert.ok(position.x > wallX + 30);
        record('Closed door blocks, open door passes using current geometry');
        await exit();
        await setGraph({ ...graph, openings: [] });
        await setGraph({ vertices: [], edges: [], rooms: [], openings: [] });
        const asset = baseline.props.find((p) => p.image?.id)?.image;
        assert.ok(asset);
        const preset = await api(gm, '/library/object-presets', 'POST', {
            assetId: asset.id,
            name: 'MAP07D temporary blocker',
            category: 'QA',
            settings: {
                width: 50,
                height: 80,
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
                    width: 50,
                    height: 80,
                    blocksMovement: true,
                    blocksVision: false,
                    blocksLight: false,
                },
            },
        });
        presets.push(preset.id);
        const created = await api(gm, scene + '/props', 'POST', {
            action: 'create',
            presetId: preset.id,
            x: wallX,
            y: center.y,
        });
        props.push(created.props[0].id);
        await sleep(200);
        await place();
        await enable(p1, tokens[0].id);
        await hold(p1, ['KeyD'], 1600);
        position = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        assert.ok(position.x <= wallX - 40);
        record('Visible blocking prop stops the full footprint');
        await exit();
        await api(gm, scene + '/props', 'POST', {
            action: 'update',
            id: props[0],
            patch: { is_hidden: true },
        });
        await place();
        await enable(p1, tokens[0].id);
        await hold(p1, ['KeyD'], 1600);
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        assert.equal((await snapshot(p1)).props.filter((p) => props.includes(p.id)).length, 0);
        const hiddenEnd = (await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id);
        assert.ok(hiddenEnd.x <= wallX - 40);
        await sleep(400);
        assert.equal((await snapshot(gm)).tokens.find((t) => t.id === tokens[0].id).x, hiddenEnd.x);
        record('Hidden blocker gives a neutral rejection, stops prediction and never retries');
        await api(gm, scene + '/selection', 'POST', {
            action: 'delete',
            tokenIds: [],
            propIds: props,
        });
        props.length = 0;
        await place();
        await enable(p1, tokens[0].id);
        await p1.evaluate(() => {
            const input = document.createElement('input');
            input.id = 'wasd-typing-check';
            document.body.append(input);
            input.focus();
        });
        await p1.keyboard.type('wasd');
        assert.equal(await p1.locator('#wasd-typing-check').inputValue(), 'wasd');
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        await p1.locator('#wasd-typing-check').evaluate((el) => el.remove());
        record('Typing focus releases WASD and preserves text input');
        // Repeated mode changes must not add listeners, Pixi children or in-flight work.
        await select(p1, tokens[0].id);
        const cdp = await p1.context().newCDPSession(p1);
        await cdp.send('HeapProfiler.collectGarbage');
        const countersBefore = await cdp.send('Memory.getDOMCounters'),
            pixiBefore = (await visual(p1, tokens[0].id)).children;
        for (let i = 0; i < 30; i++) {
            await p1.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
            await p1.keyboard.press('Escape');
        }
        await cdp.send('HeapProfiler.collectGarbage');
        const countersAfter = await cdp.send('Memory.getDOMCounters');
        assert.ok(countersAfter.jsEventListeners <= countersBefore.jsEventListeners + 5);
        assert.equal((await visual(p1, tokens[0].id)).children, pixiBefore);
        report.retention = {
            before: countersBefore,
            after: countersAfter,
            pixiChildren: pixiBefore,
            toggles: 30,
        };
        record('30 mode toggles: stable event listeners and Pixi children');
        await place();
        await enable(p1, tokens[0].id);
        await p1.evaluate(() => window.movementDisconnect());
        await p1
            .getByRole('button', { name: 'Выйти · Esc', exact: true })
            .waitFor({ state: 'hidden', timeout: 5000 });
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        await p1.reload();
        await subscribed(p1);
        await tabletop(p1).waitFor();
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        record('Reconnect hydrates snapshot and leaves WASD off with no replay');
        await place();
        await enable(p1, tokens[0].id);
        await api(gm, '/tokens/' + tokens[0].id, 'PATCH', {
            x: origins[0].x + 50,
            y: origins[0].y,
        });
        await sleep(350);
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        record('Concurrent GM correction exits direct control');
        // Two concurrent authoritative streams, with all three real renderers subscribed.
        await place(0);
        await place(1);
        const loadStart = performance.now();
        report.concurrent = await Promise.all(
            [p1, p2].map((page, index) =>
                page.evaluate(
                    async ({ id, origin }) => {
                        const { csrf } = await (await fetch('/api/session')).json();
                        async function command(action, payload) {
                            const began = performance.now();
                            const response = await fetch(
                                '/api/tokens/' + id + '/control/' + action,
                                {
                                    method: 'POST',
                                    headers: {
                                        Accept: 'application/json',
                                        'Content-Type': 'application/json',
                                        'X-CSRF-TOKEN': csrf,
                                        'X-YTT-Perf': '1',
                                    },
                                    body: JSON.stringify({
                                        ...payload,
                                        clientMutationId: crypto.randomUUID(),
                                    }),
                                },
                            );
                            const data = await response.json();
                            return {
                                data,
                                status: response.status,
                                ms: Math.round(performance.now() - began),
                                timing: response.headers.get('Server-Timing'),
                            };
                        }
                        const streamId = crypto.randomUUID();
                        const start = await command('start', { streamId });
                        if (start.status !== 200) throw Error('Concurrent start failed');
                        await new Promise((resolve) => setTimeout(resolve, 220));
                        const samples = [];
                        let position = origin;
                        for (let sequence = 1; sequence <= 10; sequence++) {
                            const began = performance.now();
                            const result = await command('step', {
                                streamId,
                                sequence,
                                origin: position,
                                x: position.x + 30,
                                y: position.y,
                            });
                            samples.push({
                                status: result.status,
                                ms: result.ms,
                                timing: result.timing,
                            });
                            if (result.status !== 200)
                                throw Error('Concurrent step failed: ' + result.data.message);
                            position = { x: result.data.token.x, y: result.data.token.y };
                            await new Promise((resolve) =>
                                setTimeout(resolve, Math.max(0, 200 - (performance.now() - began))),
                            );
                        }
                        return { samples, position };
                    },
                    { id: tokens[index].id, origin: origins[index] },
                ),
            ),
        );
        report.concurrentElapsedMs = +(performance.now() - loadStart).toFixed(1);
        report.concurrentRequestsPerSecond = +(20 / (report.concurrentElapsedMs / 1000)).toFixed(2);
        assert.ok(
            report.concurrent.every((run) => run.samples.every((sample) => sample.status === 200)),
        );
        await sleep(700);
        for (let index = 0; index < 2; index++)
            for (const page of pages) {
                const v = await visual(page, tokens[index].id);
                assert.ok(Math.abs(v.x - report.concurrent[index].position.x) < 0.01);
            }
        record('GM + 2 Players: two concurrent bounded streams accepted, all views converge');
        // Existing prepared combat only; restoration uses the documented fixture recipe.
        const combat = (await snapshot(gm)).combat;
        assert.equal(combat.status, 'preparing');
        await place();
        await enable(p1, tokens[0].id);
        combatChanged = true;
        await api(gm, scene + '/combat/begin', 'POST', { combatId: combat.id });
        await sleep(400);
        assert.equal(await p1.getByRole('button', { name: 'Выйти · Esc', exact: true }).count(), 0);
        await api(
            p1,
            '/tokens/' + tokens[0].id + '/control/start',
            'POST',
            { streamId: require('node:crypto').randomUUID() },
            422,
        );
        record('Combat start exits WASD; server independently rejects direct control');
        assert.deepEqual(report.errors, []);
    } finally {
        try {
            if (gm && baseline) {
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
                for (const t of baseline.tokens.filter((t) => ['2', '8'].includes(t.ownerUserId)))
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
                if (combatChanged)
                    require('node:child_process').execFileSync('php', ['artisan', 'qa:townhouse'], {
                        stdio: 'pipe',
                    });
                if (combatChanged) for (const t of baseline.tokens)
                    await api(gm, '/tokens/' + t.id, 'PATCH', { x: t.x, y: t.y, size: t.size, scale: t.scale });
                const restored = await snapshot(gm);
                assert.deepEqual(restored.grid, baseline.grid);
                assert.deepEqual(restored.structure?.graph, baseline.structure?.graph);
                assert.equal(restored.props.length, baseline.props.length);
                assert.deepEqual(
                    restored.tokens.map(({ id, x, y }) => ({ id, x, y })),
                    baseline.tokens.map(({ id, x, y }) => ({ id, x, y })),
                );
                record('Permanent fixture restored');
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
