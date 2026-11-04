/* eslint-disable @typescript-eslint/no-require-imports -- Browser QA on the permanent playground. */
/* global require, __dirname, process, console, window, fetch, crypto, document, FormData */
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
const out = path.join(root, 'artifacts/map06');
const base = 'http://localhost:8090';
const scene = '/scenes/5';
const prepare = '/campaigns/5/scenes/5?mode=prepare';
const checks = [];
const errors = [];
const assets = [];
const presetIds = [];
const propIds = new Set();
fs.mkdirSync(out, { recursive: true });

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
            return { status: result.status, data: await result.json().catch(() => null) };
        },
        { route, method, body },
    );
    assert.equal(response.status, status, route + ': ' + (response.data?.message ?? ''));
    return response.data;
}

async function login(browser, account) {
    const context = await browser.newContext({
        viewport: { width: 1640, height: 1060 },
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
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/login');
    await page.locator('input[type=email]').fill(account.email);
    await page.locator('input[name=password]').fill(account.password);
    await page.locator('form button.primary-button').click();
    await page.waitForURL((url) => !url.pathname.includes('login'));
    return page;
}

async function uploadArt(page, name, kind) {
    const asset = await page.evaluate(
        async ({ name, kind }) => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 192;
            const ctx = canvas.getContext('2d');
            const disk = (x, y, radius, color) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fill();
            };
            if (kind === 'tree') {
                disk(98, 105, 72, '#202f22');
                [
                    [68, 62, 42],
                    [117, 53, 39],
                    [130, 102, 45],
                    [74, 115, 43],
                    [92, 83, 49],
                ].forEach(([x, y, r], i) => {
                    disk(x, y, r, ['#496c3d', '#77905a', '#385b3b', '#557747', '#6e934c'][i]);
                    disk(x - 7, y - 9, r * 0.52, '#91a767');
                });
                disk(94, 129, 15, '#76593c');
                disk(91, 126, 7, '#aa8354');
            } else if (kind === 'stone') {
                const face = (points, fill) => {
                    ctx.fillStyle = fill;
                    ctx.beginPath();
                    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                    ctx.closePath();
                    ctx.fill();
                };
                face(
                    [
                        [22, 99],
                        [48, 51],
                        [121, 42],
                        [166, 84],
                        [157, 132],
                        [109, 157],
                        [43, 143],
                    ],
                    '#444a52',
                );
                face(
                    [
                        [22, 99],
                        [48, 51],
                        [121, 42],
                        [166, 84],
                        [99, 120],
                        [43, 117],
                    ],
                    '#8a9094',
                );
                face(
                    [
                        [48, 51],
                        [121, 42],
                        [106, 73],
                        [49, 83],
                    ],
                    '#b7b5af',
                );
                face(
                    [
                        [106, 73],
                        [121, 42],
                        [166, 84],
                        [99, 120],
                    ],
                    '#696e76',
                );
            } else {
                disk(96, 100, 78, '#373c3e');
                disk(96, 95, 72, '#9e9584');
                disk(96, 93, 59, '#6c655a');
                disk(96, 91, 54, '#d1c7b1');
                disk(96, 91, 44, '#a89d8a');
                for (let i = 0; i < 12; i++) {
                    const angle = (i * Math.PI) / 6;
                    disk(96 + 41 * Math.cos(angle), 91 + 41 * Math.sin(angle), 5, '#ded1b7');
                }
                disk(96, 91, 35, '#c7baa2');
            }
            const form = new FormData();
            form.set('category', 'props');
            form.set('file', await new Promise((resolve) => canvas.toBlob(resolve)), name + '.png');
            const { csrf } = await (await fetch('/api/session')).json();
            const response = await fetch('/api/library/assets', {
                method: 'POST',
                body: form,
                headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
            });
            if (!response.ok) throw new Error('QA illustration upload failed: ' + response.status);
            return response.json();
        },
        { name, kind },
    );
    assets.push(asset.id);
    return asset;
}

async function editor(page) {
    const close = page.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
    if (await close.isVisible()) await close.click();
    await page
        .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
        .click();
    await page.getByRole('button', { name: 'Object Presets', exact: true }).waitFor();
}

const shot = async (page, name) => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
    return page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' });
};
const library = '/library/object-presets';
const snapshot = (page) => api(page, scene + '/snapshot');
const flag = { blocksMovement: true, blocksVision: false, blocksLight: false };
function mapState(sceneState) {
    const { map, mapWorld, width, height, grid } = sceneState;
    return {
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
    };
}

async function responseAfter(page, endpoint, method, action) {
    const pending = page.waitForResponse(
        (r) => r.url().endsWith('/api' + endpoint) && r.request().method() === method,
    );
    await action();
    const response = await pending;
    const data = await response.json();
    assert.equal(response.status(), 200, data.message ?? endpoint);
    return data;
}

async function stamp(page, name, points, rotate = false) {
    await page.getByRole('button', { name: 'Object Presets', exact: true }).click();
    const card = page
        .locator('.object-preset-grid article')
        .filter({ has: page.getByText(name, { exact: true }) });
    await card.getByRole('button', { name: 'Разместить', exact: true }).click();
    if (rotate) await page.keyboard.press('r');
    for (const [x, y] of points) {
        await page.mouse.move(x, y);
        if (name === 'MAP06 · Дерево' && propIds.size === 2) {
            await page.waitForTimeout(220);
            await shot(page, '02-tree-ghost');
        }
        const result = await responseAfter(page, scene + '/props', 'POST', () =>
            page.mouse.click(x, y),
        );
        propIds.add(result.props[0].id);
        assert.equal(result.props[0].name, name);
        await page.locator('.map-editor-status .save-saved').waitFor();
    }
    await page.keyboard.press('Escape');
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm,
        player,
        baseline,
        restored = false,
        setup,
        mapChanged = false;
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
                'utf8',
            ),
        );
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
        );
        player = await login(
            browser,
            accounts.find((a) => a.id === 2),
        );
        baseline = await snapshot(gm);
        if (!baseline.mapWorld) {
            const expected = mapState(baseline);
            await api(gm, scene + '/map-world', 'POST', {
                expected,
                value: { ...expected, enabled: true },
            });
            mapChanged = true;
        }
        const structure = (await snapshot(gm)).structure;
        const graph = structure.graph;
        if (!graph.edges.length) {
            setup = await api(gm, scene + '/structure', 'POST', {
                expected: structure.hash,
                value: {
                    ...graph,
                    vertices: [
                        { id: 'map06-a', x: baseline.width * 0.17, y: baseline.height * 0.68 },
                        { id: 'map06-b', x: baseline.width * 0.83, y: baseline.height * 0.68 },
                    ],
                    edges: [
                        {
                            id: 'map06-wall',
                            a: 'map06-a',
                            b: 'map06-b',
                            thickness: 22,
                            materialVersionId: null,
                            ...flag,
                            blocksVision: true,
                            blocksLight: true,
                        },
                    ],
                    openings: [
                        {
                            id: 'map06-door',
                            edgeId: 'map06-wall',
                            center: 0.35,
                            width: 85,
                            type: 'door',
                            open: true,
                            locked: false,
                            hinge: 'a',
                            direction: 'left',
                            angle: 75,
                        },
                        {
                            id: 'map06-window',
                            edgeId: 'map06-wall',
                            center: 0.7,
                            width: 105,
                            type: 'window',
                            frame: 'iron',
                            ...flag,
                        },
                    ],
                },
            });
        }
        const events = [];
        player.on('websocket', (socket) =>
            socket.on('framereceived', ({ payload }) => {
                try {
                    const frame = JSON.parse(String(payload));
                    const event =
                        typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    if (event?.type === 'objects.changed') events.push(event);
                } catch {
                    // Non-tabletop frame.
                }
            }),
        );
        await player.goto(base + '/campaigns/5/play');
        await snapshot(player);
        await player.locator('.canvas-host canvas').waitFor();
        const tree = await uploadArt(gm, 'MAP06 Oak', 'tree');
        const stone = await uploadArt(gm, 'MAP06 Boulder', 'stone');
        const column = await uploadArt(gm, 'MAP06 Column', 'column');
        for (const [asset, name, width, height, rotation, scaleX, scaleY, collider] of [
            [
                tree,
                'Дерево',
                190,
                190,
                15,
                1.15,
                0.9,
                { ...flag, blocksVision: true, type: 'circle', x: 95, y: 117, radius: 40 },
            ],
            [
                stone,
                'Камень',
                142,
                128,
                30,
                0.8,
                1.4,
                {
                    ...flag,
                    type: 'polygon',
                    points: [
                        { x: 18, y: 65 },
                        { x: 40, y: 37 },
                        { x: 92, y: 30 },
                        { x: 121, y: 57 },
                        { x: 113, y: 91 },
                        { x: 79, y: 105 },
                        { x: 30, y: 95 },
                    ],
                },
            ],
            [
                column,
                'Колонна',
                126,
                126,
                45,
                0.8,
                1.2,
                {
                    ...flag,
                    blocksVision: true,
                    blocksLight: true,
                    type: 'circle',
                    x: 63,
                    y: 62,
                    radius: 44,
                },
            ],
        ]) {
            const preset = await api(gm, library, 'POST', {
                assetId: asset.id,
                name: 'MAP06 · ' + name,
                category: 'MAP06 QA',
                settings: {
                    width,
                    height,
                    rotation,
                    scaleX,
                    scaleY,
                    pivotX: 0.5,
                    pivotY: 0.6,
                    tags: ['map06-qa'],
                    collider,
                },
            });
            presetIds.push(preset.id);
        }
        await gm.goto(base + prepare);
        await editor(gm);
        await gm.getByRole('button', { name: 'Object Presets', exact: true }).click();
        await gm.getByRole('button', { name: 'Новый пресет', exact: true }).click();
        await gm.getByRole('button', { name: 'Изображение из Assets' }).click();
        const assetsDialog = gm.getByRole('dialog', { name: 'Assets · выбрать изображение' });
        await assetsDialog.getByText('Стол с письмом', { exact: true }).click();
        await assetsDialog.getByRole('button', { name: 'Выбрать ресурс', exact: true }).click();
        await gm.getByLabel('Название', { exact: true }).fill('MAP06 · Стол');
        await gm.getByLabel('Категория', { exact: true }).fill('MAP06 QA');
        await gm.getByLabel('Ширина', { exact: true }).fill('172');
        await gm.getByLabel('Высота', { exact: true }).fill('119');
        await gm.getByLabel('Поворот, °', { exact: true }).fill('20');
        await gm.getByLabel('Форма').selectOption('polygon');
        await gm.getByRole('button', { name: 'Вставить после маркера' }).click();
        const handle = await gm.locator('.collider-preview [data-handle="1"]').boundingBox();
        await gm.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await gm.mouse.down();
        await gm.keyboard.down('Shift');
        await gm.mouse.move(handle.x + handle.width / 2 + 25, handle.y + handle.height / 2 - 16, {
            steps: 6,
        });
        await gm.mouse.up();
        await gm.keyboard.up('Shift');
        assert.ok(
            await gm
                .getByRole('dialog', { name: 'Редактор пресета объекта' })
                .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
            'Preset editor must fit horizontally',
        );
        await shot(gm, '01-polygon-editor');
        const table = await responseAfter(gm, library, 'POST', () =>
            gm.getByRole('button', { name: 'Сохранить пресет' }).click(),
        );
        presetIds.push(table.id);
        assert.equal(table.settings.collider.points.length, 5);
        assert.notEqual(table.settings.collider.points[1].y, table.settings.collider.points[0].y);
        await gm
            .getByRole('dialog', { name: 'Object Presets · Assets' })
            .getByRole('button', { name: /close dialog|закрыть/i })
            .click();
        await gm.getByLabel('Коллайдеры', { exact: true }).check();
        await stamp(
            gm,
            'MAP06 · Стол',
            [
                [610, 420],
                [810, 560],
            ],
            true,
        );
        await stamp(
            gm,
            'MAP06 · Дерево',
            [
                [825, 370],
                [1050, 550],
            ],
            true,
        );
        await stamp(gm, 'MAP06 · Камень', [[665, 640]], true);
        await stamp(gm, 'MAP06 · Колонна', [[1050, 365]], true);
        await shot(gm, '03-map-colliders');
        const state = await snapshot(gm);
        const placed = state.props.filter((prop) => propIds.has(prop.id));
        assert.equal(placed.length, 6);
        assert.deepEqual(
            placed.filter((prop) => prop.name === table.name).map((prop) => prop.rotation),
            [35, 35],
        );
        assert.ok(placed.some((prop) => prop.scaleX !== prop.scaleY));
        checks.push(
            'GM polygon editor with snapped drag, six browser stamps, R rotation, anisotropic scale, debug outlines',
        );
        const columnProp = placed.find((prop) => prop.name.includes('Колонна'));
        await responseAfter(gm, scene + '/edit-history', 'POST', () =>
            gm.keyboard.press('Control+z'),
        );
        assert.equal(
            (await snapshot(gm)).props.some((p) => p.id === columnProp.id),
            false,
        );
        await responseAfter(gm, scene + '/edit-history', 'POST', () =>
            gm.keyboard.press('Control+Shift+z'),
        );
        assert.deepEqual(
            (await snapshot(gm)).props.find((p) => p.id === columnProp.id),
            columnProp,
        );
        await gm.mouse.click(1050, 365);
        await gm.getByRole('button', { name: 'Коллайдер экземпляра', exact: true }).click();
        await gm.getByLabel('Форма').selectOption('rectangle');
        const instance = await responseAfter(gm, scene + '/props', 'POST', () =>
            gm.getByRole('button', { name: 'Применить к экземпляру' }).click(),
        );
        assert.equal(instance.props[0].collider.type, 'rectangle');
        await gm.locator('.map-editor-status .save-saved').waitFor();
        await responseAfter(gm, scene + '/edit-history', 'POST', () =>
            gm.getByRole('button', { name: 'Отменить правку', exact: true }).click(),
        );
        assert.deepEqual(
            (await snapshot(gm)).props.find((p) => p.id === columnProp.id),
            columnProp,
        );
        await api(gm, library + '/' + table.id, 'PATCH', {
            name: table.name + ' changed',
            category: table.category,
            assetId: table.asset.id,
            settings: { ...table.settings, width: 280, collider: { ...flag, type: 'none' } },
        });
        await gm.reload();
        await editor(gm);
        await gm.getByLabel('Коллайдеры', { exact: true }).check();
        assert.deepEqual(
            (await snapshot(gm)).props.filter((prop) => propIds.has(prop.id)),
            placed,
        );
        await shot(gm, '04-reload');
        const playerState = await snapshot(player);
        await player
            .locator('.canvas-host canvas')
            .waitFor({ timeout: 8000 })
            .catch(async () => {
                const waiting = await player
                    .locator('.player-waiting')
                    .innerText({ timeout: 2000 })
                    .catch(() => '');
                throw new Error('Player canvas unavailable. ' + waiting);
            });
        const visible = playerState.props.filter((prop) => propIds.has(prop.id));
        assert.equal(visible.length, 6);
        assert.ok(visible.every((prop) => !('preset' in prop) && !('collider' in prop)));
        assert.ok(
            events.some((event) => event.payload.props?.some((prop) => propIds.has(prop.id))),
        );
        assert.doesNotMatch(JSON.stringify(events), /"collider"|"preset"|"map06-qa"/);
        assert.equal(await player.getByLabel('Коллайдеры', { exact: true }).count(), 0);
        await api(
            player,
            scene + '/props',
            'POST',
            { action: 'create', presetId: table.id, x: 30, y: 30 },
            403,
        );
        const reconnect = player.waitForResponse(
            (r) => r.url().endsWith('/api' + scene + '/snapshot') && r.ok(),
        );
        await player.evaluate(() => window.__mapQaDisconnect());
        const reconnectState = await (await reconnect).json();
        assert.deepEqual(
            reconnectState.props.filter((prop) => propIds.has(prop.id)),
            visible,
        );
        await shot(player, '05-player-after-reconnect');
        checks.push(
            'Undo/Redo, instance collider edit, wall/window/open-door footprint, reload, immutable placement snapshot, Player permission, filtered realtime DTO and Reverb reconnect',
        );
        assert.deepEqual(errors, []);
    } catch (error) {
        if (gm) await shot(gm, 'failure').catch(() => {});
        if (player) await shot(player, 'failure-player').catch(() => {});
        throw error;
    } finally {
        try {
            if (gm && baseline) {
                const current = await snapshot(gm);
                for (const prop of current.props) {
                    if (presetIds.includes(prop.preset?.presetId)) propIds.add(prop.id);
                }
                const placed = current.props.filter((prop) => propIds.has(prop.id));
                if (placed.length)
                    await api(gm, scene + '/selection', 'POST', {
                        action: 'delete',
                        tokenIds: [],
                        propIds: placed.map((prop) => prop.id),
                    });
                for (const id of presetIds)
                    await api(gm, library + '/' + id, 'DELETE', undefined, 204);
                for (const id of assets) await api(gm, '/assets/' + id, 'DELETE');
                if (setup)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '5',
                                expected: { hash: setup.structure.hash },
                                value: setup.structureEdit.before,
                            },
                        ],
                    });
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
                const final = await snapshot(gm);
                for (const key of ['props', 'tokens', 'mapWorld', 'structure', 'terrain', 'combat'])
                    assert.deepEqual(final[key], baseline[key], key);
                restored = true;
            }
        } finally {
            fs.writeFileSync(
                path.join(out, 'report.json'),
                JSON.stringify({ checks, errors, restored }, null, 2),
            );
            await browser.close();
        }
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
