/* eslint-disable @typescript-eslint/no-require-imports -- Native local browser QA. */
/* global require, __dirname, process, console, document, window, fetch, crypto, FormData, File, Event */
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
const out = path.join(root, 'artifacts/map04');
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

async function texture(page, name, type) {
    return page.evaluate(
        async ({ name, type }) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 128;
            const ctx = canvas.getContext('2d');
            const image = ctx.createImageData(128, 128);
            const tint = { terrain: [74, 88, 53], floor: [133, 112, 87], wall: [165, 160, 143] }[
                type
            ];
            for (let y = 0; y < 128; y++)
                for (let x = 0; x < 128; x++) {
                    const i = 4 * (y * 128 + x);
                    const row = Math.floor(y / 16);
                    const joint =
                        type !== 'terrain' && (y % 16 < 1 || (x + (row % 2) * 16) % 32 < 1);
                    const grain = (((x * 1543) ^ (y * 3697) ^ (x * y * 877)) % 23) - 11;
                    const shade = joint
                        ? -39
                        : grain + Math.sin((x * Math.PI) / 16) * 4 + (row % 3) * 3;
                    for (let c = 0; c < 3; c++) image.data[i + c] = tint[c] + shade;
                    image.data[i + 3] = 255;
                }
            ctx.putImageData(image, 0, 0);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            const { csrf } = await (await fetch('/api/session')).json();
            const form = new FormData();
            form.append('category', 'art');
            form.append('file', new File([blob], name + '.png', { type: 'image/png' }));
            const r = await fetch('/api/library/assets', {
                method: 'POST',
                headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
                body: form,
            });
            if (!r.ok) throw Error('Texture upload failed: ' + r.status);
            return r.json();
        },
        { name, type },
    );
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
    const assets = [],
        materials = {};
    const graphEdits = new Set();
    let gm, player, baseline, terrain;
    try {
        gm = await login(browser, 1, accounts);
        player = await login(browser, 2, accounts);
        gm.on('response', async (r) => {
            if (!r.ok() || r.request().method() !== 'POST') return;
            if (r.url().endsWith(scene + '/terrain')) terrain = (await r.json()).terrainEdit;
            if (
                r.url().endsWith(scene + '/structure') ||
                r.url().endsWith(scene + '/edit-history')
            ) {
                const result = await r.json();
                if (result.structure) graphEdits.add(result.structure.hash);
            }
        });
        await gm.goto(base + prepare);
        const original = await ok(gm, scene + '/snapshot');
        assert.equal(
            original.structure?.graph.edges.length ?? 0,
            0,
            'Fixture already contains walls',
        );
        assert.equal(original.terrain.chunks.length, 0, 'Fixture already contains terrain');
        baseline = original;
        const state = mapState(baseline);
        const cell = Math.round(Math.min(state.width, state.height) / 19);
        assert.ok(cell >= 20 && cell <= 160);
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
        for (const [type, title, repeatSize] of [
            ['wall', 'Ashlar', 96],
            ['floor', 'Flagstone', 144],
            ['terrain', 'Meadow', 160],
        ]) {
            const name = 'MAP04 QA ' + title;
            const asset = await texture(gm, name, type);
            assets.push(asset.id);
            materials[type] = await ok(gm, '/library/materials', 'POST', {
                name,
                type,
                assetId: asset.id,
                repeatSize,
                rotation: 0,
                variation: { offset: false, quarterTurns: false },
            });
        }
        const received = [];
        player.on('websocket', (socket) =>
            socket.on('framereceived', ({ payload }) => {
                try {
                    const frame = JSON.parse(String(payload));
                    const event =
                        typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    if (event?.type === 'structure.updated') received.push(event);
                } catch {
                    /* Ignore non-tabletop frames. */
                }
            }),
        );
        await player.goto(base + '/campaigns/5/play');
        await player.locator('.canvas-host canvas').waitFor();
        assert.equal((await api(player, '/assets/' + assets[0])).status, 403);
        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        await editor(gm);
        const mode = (name) => gm.getByRole('button', { name, exact: true }).click();
        const box = await gm.locator('.canvas-host canvas').boundingBox();
        const zoom = Math.min(
            (box.width - 32) / blank.width,
            (box.height - 32) / blank.height,
            1.2,
        );
        const cx = Math.floor((blank.width * 0.45) / cell),
            cy = Math.floor((blank.height * 0.46) / cell);
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
        const structure = (action) => commit(gm, '/structure', action);
        await gm
            .getByLabel('Материал стены', { exact: true })
            .selectOption(materials.wall.versionId);
        await mode('Комната');
        const emptyRoom = (await structure(() => drag([3, 7], [8, 10]))).structure;
        assert.equal(emptyRoom.graph.rooms[0].materialVersionId, null);
        await capture(gm, '01-empty-room');
        await commit(gm, '/edit-history', () => mode('Отменить правку'));
        const room = (await structure(() => drag([-6, -4], [0, 2]))).structure;
        assert.equal(room.graph.edges.length, 4);
        assert.equal(room.graph.rooms[0].materialVersionId, null);
        assert.ok(room.graph.vertices.every((v) => v.x % cell === 0 && v.y % cell === 0));
        await mode('Стены');
        await click(-2, -2);
        await gm.keyboard.press('Escape');
        const walls = (
            await structure(async () => {
                await click(-3, -4 + 3 / zoom / cell);
                await click(-3, -7);
                await gm.mouse.dblclick(...pt(0, -7));
            })
        ).structure;
        assert.equal(walls.graph.edges.length, 7);
        assert.equal(walls.graph.rooms[0].loop.length, 5);
        await mode('Сегмент');
        const attached = (await structure(() => drag([0, -7], [2, -6]))).structure;
        assert.equal(attached.graph.edges.length, 8);
        assert.equal(attached.graph.vertices.length, 8);
        await capture(gm, '02-connected-walls');

        await mode('Terrain');
        await gm.getByRole('button', { name: /MAP04 QA Meadow/ }).click();
        await gm.getByLabel('Размер кисти', { exact: true }).evaluate((element) => {
            const set = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value',
            ).set;
            set.call(element, '520');
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const painted = await commit(gm, '/terrain', () => drag([-6, 0], [5, 0]));
        assert.ok(painted.terrain.chunks.length > 0);
        terrain = painted.terrainEdit;
        await mode('Build');
        await mode('Правка');
        await gm
            .getByLabel('Материал пола', { exact: true })
            .selectOption(materials.floor.versionId);
        await click(-3, -1);
        const floored = (await structure(() => mode('Применить пол'))).structure;
        assert.equal(floored.graph.rooms[0].materialVersionId, materials.floor.versionId);
        await gm.keyboard.press('Escape');
        await mode('Комната');
        await capture(gm, '03-terrain-and-floor');

        await mode('Контур');
        const contour = (
            await structure(async () => {
                for (const [x, y] of [
                    [2, -4],
                    [5, -4],
                    [6, -3],
                    [6, 0],
                    [4, 0],
                    [4, 2],
                    [2, 2],
                ])
                    await click(x, y);
                await gm.keyboard.press('Enter');
            })
        ).structure;
        assert.equal(contour.graph.rooms.length, 2);
        assert.ok(contour.graph.rooms.some((r) => r.loop.length === 7));
        await capture(gm, '04-complex-contour');

        await mode('Правка');
        await click(-6, -1);
        const split = (await structure(() => mode('Разделить пополам'))).structure;
        assert.equal(split.graph.edges.length, contour.graph.edges.length + 1);
        assert.ok(contour.graph.edges.every((e) => split.graph.edges.some((s) => s.id === e.id)));
        const moved = (await structure(() => drag([-6, -1], [-7, -1]))).structure;
        assert.equal(moved.graph.edges.length, split.graph.edges.length);
        assert.ok(
            moved.graph.vertices.some((v) => v.x === (cx - 7) * cell && v.y === (cy - 1) * cell),
        );
        const edgeMove = (await structure(() => drag([1, -6.5], [1, -5.5]))).structure;
        assert.notEqual(edgeMove.hash, moved.hash);
        await capture(gm, '05a-split-and-move');
        await click(-7, -1);
        const deleted = (await structure(() => gm.keyboard.press('Delete'))).structure;
        assert.equal(deleted.graph.edges.length, moved.graph.edges.length - 2);
        assert.equal(deleted.graph.rooms.length, 1);
        await capture(gm, '05-edit-split-delete');
        const undo = await commit(gm, '/edit-history', () => mode('Отменить правку'));
        assert.equal(undo.structure.hash, edgeMove.hash);
        const redo = await commit(gm, '/edit-history', () => mode('Повторить правку'));
        assert.equal(redo.structure.hash, deleted.hash);
        await commit(gm, '/edit-history', () => mode('Отменить правку'));
        report.checks.push(
            'Rectangle, polyline, segment, structural grid/edge/vertex snap, terrain stroke, concave floor, split, vertex/edge drag, delete, Undo/Redo',
        );

        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        const reloaded = await ok(gm, scene + '/snapshot');
        assert.equal(reloaded.structure.hash, edgeMove.hash);
        assert.deepEqual(reloaded.props, baseline.props);
        assert.doesNotMatch(JSON.stringify(received), /blocksVision|structureEdit|snapshot/);
        const resync = player.waitForResponse(
            (r) => r.url().endsWith(scene + '/snapshot') && r.ok(),
        );
        await player.evaluate(() => window.__mapQaDisconnect());
        const synced = await (await resync).json();
        assert.ok(received.some((e) => e.payload.structurePatch?.hash === synced.structure.hash));
        assert.notEqual(synced.structure.hash, edgeMove.hash);
        assert.deepEqual(synced.structure.graph.vertices, edgeMove.graph.vertices);
        assert.deepEqual(synced.structure.graph.rooms, edgeMove.graph.rooms);
        assert.equal((await api(player, '/assets/' + assets[0])).status, 200);
        assert.equal(
            (
                await api(player, scene + '/structure', 'POST', {
                    expected: synced.structure.hash,
                    value: synced.structure.graph,
                })
            ).status,
            403,
        );
        await capture(player, '06-player-reconnect');
        await gm.goto(base + '/campaigns/5/scenes/5?mode=session');
        await gm.locator('.workspace.session-mode').waitFor();
        await gm.locator('.canvas-host canvas').waitFor();
        assert.equal(await gm.getByRole('button', { name: 'Build', exact: true }).count(), 0);
        await capture(gm, '07-gm-session');
        report.checks.push(
            'Reload, live Player patches and texture access, WebSocket reconnect, GM Session render, Player edit denied',
        );
        assert.deepEqual(report.errors, []);
    } catch (error) {
        if (gm) await capture(gm, 'failure').catch(() => {});
        throw error;
    } finally {
        try {
            if (baseline) {
                const current = await ok(gm, scene + '/snapshot');
                if (current.structure?.graph.edges.length) {
                    assert.ok(
                        graphEdits.has(current.structure.hash),
                        'Refusing to overwrite an external graph edit',
                    );
                    await ok(gm, scene + '/structure', 'POST', {
                        expected: current.structure.hash,
                        value: { vertices: [], edges: [], rooms: [] },
                    });
                }
                if (terrain)
                    await ok(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'terrain',
                                id: '5',
                                expected: terrain.after.hashes,
                                value: terrain.before,
                            },
                        ],
                    });
                const expected = mapState(await ok(gm, scene + '/snapshot'));
                const value = mapState(baseline);
                if (value.enabled) await ok(gm, scene + '/map-world', 'POST', { expected, value });
                else
                    await ok(gm, scene + '/edit-history', 'POST', {
                        changes: [{ kind: 'mapWorld', id: '5', expected, value }],
                    });
                for (const material of Object.values(materials))
                    await ok(gm, '/library/materials/' + material.id, 'DELETE');
                for (const id of assets) await ok(gm, '/assets/' + id, 'DELETE');
                const restored = await ok(gm, scene + '/snapshot');
                for (const key of ['tokens', 'props', 'combat', 'terrain', 'structure'])
                    assert.deepEqual(restored[key], baseline[key], key);
                assert.deepEqual(mapState(restored), value);
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
