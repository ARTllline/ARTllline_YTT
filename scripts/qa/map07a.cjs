/* eslint-disable @typescript-eslint/no-require-imports -- Browser QA on the permanent playground. */
/* global require, module, __dirname, process, console, window, fetch, crypto */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const root = path.resolve(__dirname, '../..');
const base = 'http://localhost:8090';
const scene = '/scenes/5';
const gmRoute = '/campaigns/5/scenes/5?mode=session';
const playerRoute = '/campaigns/5/play';

async function api(page, route, method = 'GET', body, status = 200) {
    const response = await page.evaluate(
        async ({ route, method, body }) => {
            const { csrf } = await (await fetch('/api/session')).json();
            const result = await fetch('/api' + route, {
                method,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrf,
                },
                body: body
                    ? JSON.stringify({ ...body, clientMutationId: crypto.randomUUID() })
                    : undefined,
            });
            return { status: result.status, data: result.status === 204 ? null : await result.json() };
        },
        { route, method, body },
    );
    assert.equal(response.status, status, route + ': ' + (response.data?.message ?? ''));
    return response.data;
}

async function login(browser, account, options = {}) {
    const context = await browser.newContext({
        viewport: { width: 1680, height: 1050 },
        reducedMotion: 'no-preference',
        ...options,
    });
    await context.addInitScript(() => {
        window.__PIXI_APP_INIT__ = (app) => {
            window.tabletopApp = app;
        };
        const Native = window.WebSocket;
        const sockets = new Set();
        window.movementFrames = [];
        window.movementDisconnect = () => sockets.forEach((socket) => socket.close());
        window.WebSocket = class extends Native {
            constructor(...args) {
                super(...args);
                sockets.add(this);
                this.addEventListener('close', () => sockets.delete(this));
                this.addEventListener('message', ({ data }) => window.movementFrames.push(data));
            }
        };
    });
    const page = await context.newPage();
    await page.goto(base + '/login');
    await page.locator('input[type=email]').fill(account.email);
    await page.locator('input[name=password]').fill(account.password);
    await page.locator('form button.primary-button').click();
    await page.waitForURL((url) => !url.pathname.includes('login'));
    return page;
}

const snapshot = (page) => api(page, scene + '/snapshot');
const tabletop = (page) => page.locator('canvas[aria-label]').first();
const snap = (v, size, offset) =>
    Math.round((v - offset - size / 2) / size) * size + offset + size / 2;
const mapState = ({ map, mapWorld, width, height, grid }) => ({
    enabled: !!mapWorld,
    width,
    height,
    grid,
    map: map
        ? {
              assetId: map.asset.id,
              x: map.x,
              y: map.y,
              width: map.width,
              height: map.height,
              crop: map.crop ?? null,
          }
        : null,
});
const subscribed = (page) =>
    page.waitForFunction(() =>
        window.movementFrames.some((frame) => frame.includes('subscription_succeeded')),
    );
async function drag(page, state, from, to, status) {
    const canvas = tabletop(page);
    await canvas.waitFor();
    const box = await canvas.boundingBox();
    const zoom = Math.min((box.width - 32) / state.width, (box.height - 32) / state.height, 1.2);
    const screen = ({ x, y }) => ({
        x: box.x + (box.width - state.width * zoom) / 2 + x * zoom,
        y: box.y + (box.height - state.height * zoom) / 2 + y * zoom,
    });
    const a = screen(from),
        b = screen(to);
    const response = page.waitForResponse(
        (r) => r.url().includes('/api/tokens/') && r.url().endsWith('/move'),
        { timeout: 10000 },
    );
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y);
    await page.mouse.up();
    const result = await response;
    assert.equal(result.status(), status);
    return result.json();
}

async function sampleToken(page, id) {
    await tabletop(page).waitFor();
    await page.evaluate((tokenId) => {
        const app = window.tabletopApp;
        const find = (view) => {
            if (view.model?.id === tokenId && view.badges) return view;
            for (const child of view.children ?? []) {
                const result = find(child);
                if (result) return result;
            }
        };
        const view = find(app.stage);
        if (!view) throw new Error('Token view is missing');
        const samples = [];
        const sample = () => samples.push({ x: view.x, y: view.y });
        sample();
        app.ticker.add(sample, undefined, -50);
        window.tokenSample = {
            samples,
            stop: () => app.ticker.remove(sample),
        };
    }, id);
}

async function finishSample(page, destination) {
    await page.waitForFunction(
        ({ x, y }) => {
            const { samples } = window.tokenSample;
            return samples.length > 1 && samples.at(-1).x === x && samples.at(-1).y === y;
        },
        { x: destination.x, y: destination.y },
    );
    return page.evaluate(() => {
        window.tokenSample.stop();
        return window.tokenSample.samples;
    });
}

module.exports = { api, login, snapshot, tabletop, mapState, subscribed, drag, sampleToken, finishSample, base, scene };

if (require.main === module) (async () => {
    const accounts = JSON.parse(
        fs.readFileSync(
            path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
            'utf8',
        ),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, baseline, token, structureEdit, mapChanged, gridChanged, tokenChanged;
    const report = [];
    try {
        const [host, first, second] = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    browser,
                    accounts.find((a) => a.id === id),
                ),
            ),
        );
        gm = host;
        baseline = await snapshot(gm);
        assert.notEqual(baseline.combat?.status, 'active', 'Fixture combat must be inactive.');
        assert.equal(
            baseline.structure?.graph.edges.length ?? 0,
            0,
            'Fixture already contains structure.',
        );
        token = baseline.tokens.find((item) => String(item.ownerUserId) === '2');
        assert.ok(token && !token.isLocked && !token.isHidden, 'Fixture token is unavailable.');
        if (!baseline.mapWorld) {
            const expected = mapState(baseline);
            await api(gm, scene + '/map-world', 'POST', {
                expected,
                value: { ...expected, enabled: true },
            });
            mapChanged = true;
        }
        const state = await snapshot(gm);
        const size = state.grid.size;
        const x = Math.round(state.width * 0.5);
        const y = snap(state.height * 0.52, size, state.grid.offset.y);
        const left = { x: snap(x - size * 2, size, state.grid.offset.x), y };
        const right = { x: snap(x + size * 2, size, state.grid.offset.x), y };
        const span = Math.max(200, size * 2.5);
        const width = token.size * token.scale + 24;
        assert.ok(y > span + 12 && y + span + 12 < state.height && width <= 512);
        const toggle = async (open, status = 200) => {
            const expected = (await snapshot(gm)).structure.hash;
            return api(
                gm,
                scene + '/structure',
                'POST',
                { door: { id: 'qa-door', open }, expected },
                status,
            );
        };
        const tokenPath = '/tokens/' + token.id;
        await api(gm, tokenPath, 'PATCH', left);
        tokenChanged = true;
        const saved = await api(gm, scene + '/structure', 'POST', {
            expected: state.structure.hash,
            value: {
                rooms: [],
                vertices: [
                    { id: 'qa-a', x, y: y - span },
                    { id: 'qa-b', x, y: y + span },
                ],
                edges: [
                    {
                        id: 'qa-wall',
                        a: 'qa-a',
                        b: 'qa-b',
                        thickness: 12,
                        blocksMovement: true,
                        blocksVision: false,
                        blocksLight: false,
                        materialVersionId: null,
                    },
                ],
                openings: [
                    {
                        id: 'qa-door',
                        edgeId: 'qa-wall',
                        type: 'door',
                        center: 0.5,
                        width,
                        open: false,
                        locked: false,
                        hinge: 'a',
                        direction: 'left',
                        angle: 90,
                    },
                ],
            },
        });
        structureEdit = saved.structureEdit;
        await api(gm, scene + '/grid', 'PUT', { ...state.grid, snap: true });
        gridChanged = true;
        await Promise.all([
            gm.goto(base + gmRoute),
            first.goto(base + playerRoute),
            second.goto(base + playerRoute),
        ]);
        await Promise.all([gm, first, second].map(subscribed));
        await drag(gm, state, left, right, 422);
        await drag(first, state, left, right, 422);
        await first
            .locator('.player-notice')
            .filter({ hasText: /недоступно|unavailable/i })
            .waitFor();
        assert.ok(
            Math.abs((await snapshot(gm)).tokens.find((t) => t.id === token.id).x - left.x) < 0.001,
        );
        report.push('GM and Player grid drag rejected at closed door');
        await api(gm, scene + '/grid', 'PUT', { ...state.grid, snap: false });
        await first.reload();
        await subscribed(first);
        await drag(first, state, left, right, 422);
        report.push('Player free drag rejected at same door');
        structureEdit.after = (await toggle(true)).structureEdit.after;
        await Promise.all([gm, first, second].map((page) => sampleToken(page, token.id)));
        await drag(first, state, left, right, 200);
        const committed = (await snapshot(gm)).tokens.find((t) => t.id === token.id);
        assert.ok(Math.abs(committed.x - right.x) < 3);
        const animations = await Promise.all(
            [gm, first, second].map((page) => finishSample(page, committed)),
        );
        for (const samples of animations) {
            assert.ok(samples.some(({ x }) => x > left.x + 1 && x < committed.x - 1));
            assert.ok(samples.every(({ x }, i) => !i || x >= samples[i - 1].x - 0.001));
        }
        report.push('Accepted Player drag interpolates in Pixi for the mover, GM and Player 2');
        await api(gm, scene + '/grid', 'PUT', { ...state.grid, snap: true });
        await gm.reload();
        await subscribed(gm);
        await sampleToken(gm, token.id);
        const snapMove = await drag(gm, state, committed, left, 200);
        assert.ok(Math.abs(snapMove.token.x - left.x) < size);
        assert.ok(
            Math.abs(snapMove.token.x - snap(snapMove.token.x, size, state.grid.offset.x)) < 0.001,
        );
        assert.ok(
            Math.abs(snapMove.token.y - snap(snapMove.token.y, size, state.grid.offset.y)) < 0.001,
        );
        const snapped = await finishSample(gm, snapMove.token);
        assert.ok(snapped.some(({ x }) => x > snapMove.token.x + 1 && x < committed.x - 1));
        await sampleToken(gm, token.id);
        const override = await api(gm, tokenPath + '/move', 'POST', {
            x: committed.x,
            y: committed.y,
            intent: 'override',
        });
        assert.equal(override.tokenMovements, undefined);
        const immediate = await finishSample(gm, override.token);
        assert.ok(immediate.every(({ x }) => x === snapMove.token.x || x === committed.x));
        report.push('GM snapped drag animates and explicit override lands immediately');
        await second.emulateMedia({ reducedMotion: 'reduce' });
        await sampleToken(gm, token.id);
        await sampleToken(second, token.id);
        const waypoint = { x: committed.x + 80, y: committed.y };
        const destination = { x: waypoint.x, y: waypoint.y + 80 };
        const routed = await api(first, tokenPath + '/move', 'POST', {
            ...destination,
            waypoints: [waypoint],
        });
        const [walk, reduced] = await Promise.all([
            finishSample(gm, routed.token),
            finishSample(second, routed.token),
        ]);
        assert.ok(
            walk.some(({ x, y }) => x > committed.x + 1 && x < waypoint.x - 1 && y === waypoint.y),
        );
        assert.ok(
            walk.some(
                ({ x, y }) => x === waypoint.x && y > waypoint.y + 1 && y < destination.y - 1,
            ),
        );
        assert.ok(
            reduced.every(
                ({ x, y }) =>
                    (x === committed.x && y === committed.y) ||
                    (x === destination.x && y === destination.y),
            ),
        );
        report.push('Waypoints render both legs and reduced motion lands immediately');

        for (const watcher of [gm, second]) {
            await watcher.waitForFunction(
                (id) =>
                    window.movementFrames.some(
                        (raw) =>
                            raw.includes('token.moved') && raw.includes('"') && raw.includes(id),
                    ),
                token.id,
            );
        }
        report.push('Open door permits drag; GM and Player 2 receive the commit via Reverb');
        await api(second, tokenPath + '/move', 'POST', { ...left, intent: 'override' }, 403);
        const projection = await snapshot(second);
        assert.equal(projection.structure.graph.edges[0].blocksMovement, true);
        assert.equal(projection.structure.graph.edges[0].blocksVision, undefined);
        assert.equal(projection.structure.graph.openings[0].locked, undefined);
        assert.ok(projection.props.every((p) => !p.collider && !p.preset));
        const subscriptions = await second.evaluate(() => {
            const count = window.movementFrames.filter((f) =>
                f.includes('subscription_succeeded'),
            ).length;
            window.movementDisconnect();
            return count;
        });
        await second.waitForFunction(
            (count) =>
                window.movementFrames.filter((f) => f.includes('subscription_succeeded')).length >
                count,
            subscriptions,
        );
        await second.reload();
        await subscribed(second);
        assert.equal(
            (await snapshot(second)).tokens.find((t) => t.id === token.id).x,
            routed.token.x,
        );
        report.push('Player 2 authorization, filtered projection, reconnect and reload');
    } finally {
        try {
            if (tokenChanged)
                await api(gm, '/tokens/' + token.id, 'PATCH', { x: token.x, y: token.y });
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
            if (gridChanged) await api(gm, scene + '/grid', 'PUT', baseline.grid);
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
            if (baseline) {
                const restored = await snapshot(gm);
                assert.deepEqual(restored.grid, baseline.grid);
                assert.deepEqual(restored.structure?.graph, baseline.structure?.graph);
                assert.deepEqual(
                    restored.tokens.map(({ id, x, y }) => ({ id, x, y })),
                    baseline.tokens.map(({ id, x, y }) => ({ id, x, y })),
                );
                report.push('Fixture restored');
            }
        } finally {
            await browser.close();
        }
    }
    console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
