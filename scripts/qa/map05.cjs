/* eslint-disable @typescript-eslint/no-require-imports -- Native local browser QA. */
/* global require, __dirname, process, console, window, fetch, crypto */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'artifacts/map05');
const base = 'http://localhost:8090';
const prepare = '/campaigns/5/scenes/5?mode=prepare';
const scene = '/scenes/5';
const report = { checks: [], errors: [], restored: false };
fs.mkdirSync(out, { recursive: true });

async function api(page, route, method = 'GET', body) {
    return page.evaluate(
        async ({ route, method, body }) => {
            const { csrf } = await (await fetch('/api/session')).json();
            const r = await fetch('/api' + route, {
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
            return {
                status: r.status,
                data: r.headers.get('Content-Type')?.includes('application/json')
                    ? await r.json()
                    : null,
            };
        },
        { route, method, body },
    );
}

async function ok(page, route, method, body) {
    const r = await api(page, route, method, body);
    assert.equal(r.status, 200, route + ': ' + JSON.stringify(r.data));
    return r.data;
}

function mapState(s) {
    return {
        enabled: !!s.mapWorld,
        width: s.width,
        height: s.height,
        grid: s.grid,
        map: s.map
            ? {
                  assetId: s.map.asset.id,
                  x: s.map.x,
                  y: s.map.y,
                  width: s.map.width,
                  height: s.map.height,
                  crop: s.map.crop ?? null,
              }
            : null,
    };
}

async function commit(page, suffix, action) {
    const pending = page.waitForResponse(
        (r) => r.url().endsWith('/api' + scene + suffix) && r.request().method() === 'POST',
    );
    await action();
    const r = await pending;
    const data = await r.json();
    assert.equal(r.status(), 200, JSON.stringify(data));
    await page.locator('.map-editor-status .save-saved').waitFor();
    return data;
}

async function editor(page) {
    const close = page.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
    if (await close.isVisible()) await close.click();
    await page
        .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
        .click();
    await page.getByRole('button', { name: 'Build', exact: true }).click();
}

async function login(browser, id, accounts) {
    const context = await browser.newContext({
        viewport: { width: 1600, height: 1040 },
        reducedMotion: 'reduce',
    });
    await context.addInitScript(() => {
        const Native = window.WebSocket;
        const sockets = new Set();
        window.WebSocket = class extends Native {
            constructor(...args) {
                super(...args);
                sockets.add(this);
                this.addEventListener('close', () => sockets.delete(this));
            }
        };
        window.__mapQaDisconnect = () => sockets.forEach((socket) => socket.close());
    });
    const account = accounts.find((a) => a.id === id);
    const page = await context.newPage();
    page.on('pageerror', (e) => report.errors.push(e.message));
    await page.goto(base + '/login');
    await page.locator('input[type=email]').fill(account.email);
    await page.locator('input[name=password]').fill(account.password);
    await page.locator('form button.primary-button').click();
    await page.waitForURL((url) => !url.pathname.includes('login'));
    return page;
}

async function capture(page, name) {
    await page.waitForTimeout(650);
    if (name !== 'failure') await page.locator('.media-state').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(out, name + '.png') });
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync(
            path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
            'utf8',
        ),
    );
    const gm = await login(browser, 1, accounts);
    const player = await login(browser, 2, accounts);
    const snapshot = (page) => ok(page, scene + '/snapshot');
    const hashes = new Set();
    const received = [];
    gm.on('response', async (r) => {
        if (!r.ok() || r.request().method() !== 'POST') return;
        if (!/\/api\/scenes\/5\/(structure|edit-history)$/.test(r.url())) return;
        const result = await r.json();
        if (result.structure) hashes.add(result.structure.hash);
    });
    player.on('websocket', (socket) =>
        socket.on('framereceived', ({ payload }) => {
            try {
                const frame = JSON.parse(String(payload));
                const event = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                if (event?.type === 'structure.updated') received.push(event);
            } catch {
                // Non-tabletop frames.
            }
        }),
    );
    let baseline, setup, mapChanged;
    try {
        await gm.goto(base + prepare);
        baseline = await snapshot(gm);
        assert.equal(
            baseline.structure?.graph.edges.length ?? 0,
            0,
            'Fixture already contains walls',
        );
        const state = mapState(baseline);
        const cell = Math.round(Math.min(state.width, state.height) / 19);
        const blank = {
            ...state,
            enabled: true,
            map: null,
            grid: {
                ...state.grid,
                size: cell,
                offset: { x: 0, y: 0 },
                visible: false,
                snap: false,
            },
        };
        await ok(gm, scene + '/map-world', 'POST', { expected: state, value: blank });
        mapChanged = true;
        const cx = Math.floor((blank.width * 0.45) / cell);
        const cy = Math.floor((blank.height * 0.44) / cell);
        const vertices = [
            [-6, 0],
            [6, 0],
            [6, 4],
            [-6, 4],
        ].map(([x, y], i) => ({ id: 'v' + i, x: (cx + x) * cell, y: (cy + y) * cell }));
        const edges = vertices.map((a, i) => ({
            id: 'e' + i,
            a: a.id,
            b: vertices[(i + 1) % vertices.length].id,
            thickness: 22,
            materialVersionId: null,
            blocksMovement: true,
            blocksVision: true,
            blocksLight: true,
        }));
        const seeded = await ok(gm, scene + '/structure', 'POST', {
            expected:
                (await snapshot(gm)).structure?.hash ??
                'e9e2551ff7d2a3824cb4725dc15cf3826753f8fb28c4849fa8d448b73171831a',
            value: {
                vertices,
                edges,
                rooms: [{ id: 'room', loop: vertices.map((v) => v.id), materialVersionId: null }],
            },
        });
        setup = seeded.structureEdit.before;
        hashes.add(seeded.structure.hash);
        await player.goto(base + '/campaigns/5/play');
        await player.locator('.canvas-host canvas').waitFor();
        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        await editor(gm);

        const button = (name) => gm.getByRole('button', { name, exact: true });
        const mode = (name) => button(name).click();
        const box = await gm.locator('.canvas-host canvas').boundingBox();
        const zoom = Math.min(
            (box.width - 32) / blank.width,
            (box.height - 32) / blank.height,
            1.2,
        );
        const pt = (x, y) => [
            box.x + box.width / 2 + ((cx + x) * cell - blank.width / 2) * zoom,
            box.y + box.height / 2 + ((cy + y) * cell - blank.height / 2) * zoom,
        ];
        const click = (x, y) => gm.mouse.click(...pt(x, y));
        const drag = async (a, b) => {
            await gm.mouse.move(...pt(...a));
            await gm.mouse.down();
            await gm.mouse.move(...pt(...b), { steps: 10 });
            await gm.mouse.up();
        };
        const structure = async (action) => (await commit(gm, '/structure', action)).structure;
        const openings = (result) => result.graph.openings;
        const door = (result) => openings(result).find((o) => o.type === 'door');
        const window = (result) => openings(result).find((o) => o.type === 'window');

        await mode('Дверь');
        const closed = await structure(() => click(-3, 0));
        assert.equal(door(closed).open, false);
        await capture(gm, '01-closed-door');
        const open = await structure(() => mode('Открыть дверь'));
        assert.equal(door(open).open, true);
        await capture(gm, '02-open-door');
        await structure(() => mode('Закрыть дверь'));
        const locked = await structure(() => mode('Запереть замок'));
        assert.equal(await button('Открыть дверь').isDisabled(), true);
        assert.equal(
            (
                await api(gm, scene + '/structure', 'POST', {
                    expected: locked.hash,
                    door: { id: door(locked).id, open: true },
                })
            ).status,
            422,
        );
        await structure(() => mode('Отпереть замок'));
        await mode('Окно');
        const glazed = await structure(() => click(3, 0));
        assert.equal(window(glazed).blocksMovement, true);
        await capture(gm, '03-window');
        await mode('Окно');
        await click(3, 0);
        await gm
            .getByText('Проём пересекает другой проём или слишком близок к торцу стены.', {
                exact: true,
            })
            .waitFor();
        assert.equal((await snapshot(gm)).structure.hash, glazed.hash);
        await mode('Правка');
        const shifted = await structure(() => drag([3, 0], [4, 0]));
        assert.notEqual(window(shifted).center, window(glazed).center);
        assert.equal(window(shifted).id, window(glazed).id);
        await click(-3, 0);
        await structure(() => mode('Открыть дверь'));
        await gm.keyboard.press('Escape');
        await gm.mouse.move(box.x + box.width / 2, box.y + 100);
        await capture(gm, '04-multiple-openings');

        const moved = await structure(() => drag([0, 0], [0, -1]));
        assert.equal(door(moved).center, door(shifted).center);
        assert.equal(window(moved).center, window(shifted).center);
        await click(0, -1);
        await gm.keyboard.press('Delete');
        await gm
            .getByText('Стена содержит проём. Сначала удалите проём.', { exact: true })
            .waitFor();
        assert.equal((await snapshot(gm)).structure.hash, moved.hash);
        const split = await structure(() => mode('Разделить пополам'));
        assert.equal(split.graph.edges.length, 5);
        assert.equal(split.graph.rooms[0].loop.length, 5);
        assert.equal(door(split).id, door(moved).id);
        assert.notEqual(window(split).edgeId, window(moved).edgeId);
        await capture(gm, '05-split-edit');
        const joined = await structure(() => mode('Соединить стены'));
        assert.equal(joined.graph.edges.length, 4);
        assert.equal(joined.graph.rooms[0].loop.length, 4);
        const reversed = await structure(() => mode('Развернуть ребро'));
        assert.equal(door(reversed).hinge, 'b');
        assert.equal(door(reversed).direction, 'right');
        const undo = await commit(gm, '/edit-history', () => mode('Отменить правку'));
        assert.equal(undo.structure.hash, joined.hash);
        const redo = await commit(gm, '/edit-history', () => mode('Повторить правку'));
        assert.equal(redo.structure.hash, reversed.hash);
        report.checks.push(
            'Build placement, overlap/delete rejection, reposition, wall movement, split/join/reverse, lock, Undo/Redo',
        );

        await gm.goto(base + '/campaigns/5/scenes/5?mode=session');
        await gm.locator('.workspace.session-mode').waitFor();
        assert.equal((await snapshot(gm)).structure.hash, reversed.hash);
        await gm.getByText('Двери · 1', { exact: true }).click();
        const response = gm.waitForResponse(
            (r) => r.url().endsWith(scene + '/structure') && r.request().method() === 'POST',
        );
        await mode('Закрыть дверь');
        const session = (await (await response).json()).structure;
        assert.equal(door(session).open, false);
        assert.equal(
            (
                await api(player, scene + '/structure', 'POST', {
                    expected: session.hash,
                    door: { id: door(session).id, open: true },
                })
            ).status,
            403,
        );
        const reconnect = player.waitForResponse(
            (r) => r.url().endsWith(scene + '/snapshot') && r.ok(),
        );
        await player.evaluate(() => window.__mapQaDisconnect());
        const projection = (await (await reconnect).json()).structure;
        assert.notEqual(projection.hash, session.hash);
        assert.equal(door(projection).open, false);
        assert.equal(door(projection).locked, undefined);
        assert.equal(window(projection).blocksVision, undefined);
        assert.ok(received.some((event) => event.payload.structurePatch?.hash === projection.hash));
        assert.doesNotMatch(JSON.stringify(received), /blocksVision|structureEdit|"locked"/);
        assert.equal(await player.getByText('Двери · 1', { exact: true }).count(), 0);
        await capture(player, '06-player-session');
        const persisted = await snapshot(gm);
        for (const key of ['tokens', 'props', 'combat', 'terrain'])
            assert.deepEqual(persisted[key], baseline[key], key);
        report.checks.push(
            'Reload, GM Session toggle, Player denied, filtered realtime patch, reconnect, fixture token/prop/combat/terrain parity',
        );
        assert.deepEqual(report.errors, []);
    } catch (error) {
        await capture(gm, 'failure').catch(() => {});
        throw error;
    } finally {
        try {
            if (setup) {
                const current = await snapshot(gm);
                assert.ok(
                    hashes.has(current.structure.hash),
                    'Refusing to overwrite an external graph edit',
                );
                await ok(gm, scene + '/edit-history', 'POST', {
                    changes: [
                        {
                            kind: 'structure',
                            id: '5',
                            expected: { hash: current.structure.hash },
                            value: setup,
                        },
                    ],
                });
            }
            if (mapChanged) {
                const expected = mapState(await snapshot(gm));
                const value = mapState(baseline);
                if (value.enabled) await ok(gm, scene + '/map-world', 'POST', { expected, value });
                else
                    await ok(gm, scene + '/edit-history', 'POST', {
                        changes: [{ kind: 'mapWorld', id: '5', expected, value }],
                    });
                const restored = await snapshot(gm);
                assert.deepEqual(mapState(restored), value);
                assert.deepEqual(restored.structure, baseline.structure);
                report.restored = true;
            }
        } finally {
            fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
            console.log(JSON.stringify(report));
            await browser.close();
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
