/* eslint-disable @typescript-eslint/no-require-imports -- Reversible Chromium QA on the existing Scene 10. */
/* global require, process, console, window, document, structuredClone */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');

const scene = '/scenes/10';
const campaign = '/campaigns/5';
const out = 'artifacts/builder02';
const backup = out + '/restore.private.json';
// Keep current Player Vision and Reverb active without recording QA exploration.
const extraHTTPHeaders = { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' };
const snapshot = (page) => api(page, scene + '/snapshot');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const report = { scene: 10, zooms: [], checks: [], errors: [], passed: false, restored: false };
const check = (message) => {
    report.checks.push(message);
    console.log(message);
};
const camera = (page) =>
    page.evaluate(() => {
        const world = window.tabletopApp.stage.children[0];
        return { x: world.x, y: world.y, zoom: world.scale.x };
    });
async function position(page, [x, y]) {
    const view = await camera(page);
    const box = await tabletop(page).boundingBox();
    return [box.x + view.x + x * view.zoom, box.y + view.y + y * view.zoom];
}
async function point(page, world) {
    const screen = await position(page, world);
    assert.equal(
        await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, screen),
        'CANVAS',
        'Obscured world point ' + world,
    );
    return screen;
}
async function align(page, zoom, world) {
    const box = await tabletop(page).boundingBox();
    const center = [box.x + box.width * 0.5, box.y + box.height * 0.51];
    await page.mouse.move(...center);
    for (let step = 0; step < 12; step++) {
        const current = (await camera(page)).zoom;
        if (Math.abs(current - zoom) < 0.001) break;
        await page.mouse.wheel(0, -Math.log(zoom / current) / 0.002);
        await page.waitForTimeout(150);
    }
    const screen = await position(page, world);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(2 * center[0] - screen[0], 2 * center[1] - screen[1], { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(120);
    assert.ok(Math.abs((await camera(page)).zoom - zoom) < 0.001);
    assert.ok((await position(page, world)).every((coord, i) => Math.abs(coord - center[i]) < 3));
    report.zooms.push(Math.round(zoom * 100));
}
async function label(page, text) {
    await page.waitForFunction(
        (text) => {
            const find = (node) =>
                (node.visible && typeof node.text === 'string' && node.text.includes(text)) ||
                (node.children ?? []).some(find);
            return find(window.tabletopApp.stage);
        },
        text,
        { timeout: 4000 },
    );
}
async function editor(page) {
    await tabletop(page).waitFor();
    const library = button(page, 'Закрыть библиотеку');
    if (await library.isVisible()) await library.click();
    await button(page, 'Редактировать карту').click();
    await button(page, 'Build').click();
    await button(page, 'Правка').click();
}

const vertex = (id, x, y) => ({ id: 'qa-' + id, x, y });
const edge = (id, a, b) => ({
    id: 'qa-' + id,
    a: 'qa-' + a,
    b: 'qa-' + b,
    thickness: 16,
    materialVersionId: null,
    blocksMovement: true,
    blocksVision: true,
    blocksLight: true,
});
const index = (graph) => new Map(graph.vertices.map((v) => [v.id, v]));
const xy = (graph, id) => {
    const { x, y } = index(graph).get(id);
    return [x, y];
};
function assertTranslation(before, after, ids, dx, dy) {
    for (const v of before.vertices) {
        const [x, y] = xy(after, v.id);
        assert.ok(Math.abs(x - v.x - (ids.includes(v.id) ? dx : 0)) < 0.02);
        assert.ok(Math.abs(y - v.y - (ids.includes(v.id) ? dy : 0)) < 0.02);
    }
    for (const kind of ['edges', 'rooms', 'openings']) assert.deepEqual(after[kind], before[kind]);
}

async function playerDelta(player, structure, vertices) {
    const projected = (await snapshot(player)).structure;
    assert.deepEqual(projected.graph.vertices, structure.graph.vertices);
    assert.ok(projected.graph.edges.every((wall) => !('blocksVision' in wall)));
    const patch = await player
        .waitForFunction(
            (hash) => {
                for (const raw of window.movementFrames) {
                    const frame = JSON.parse(raw);
                    if (frame.event !== 'tabletop') continue;
                    const event =
                        typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    const patch = event?.payload?.structurePatch;
                    if (String(event?.sceneId) === '10' && patch?.hash === hash) return patch;
                }
            },
            projected.hash,
            { timeout: 10000 },
        )
        .then((handle) => handle.jsonValue());
    assert.deepEqual(patch.vertices.upsert.map((v) => v.id).sort(), [...vertices].sort());
    assert.doesNotMatch(
        JSON.stringify(patch),
        /"blocksVision"|"blocksLight"|"blocksMovement"|"locked"/,
    );
}

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.browser = 'Chromium ' + browser.version();
    let gm, restore;
    const capture = (page, name) => page.screenshot({ path: out + '/' + name + '.png' });
    try {
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
            {
                viewport: { width: 1700, height: 1130 },
                reducedMotion: 'reduce',
                extraHTTPHeaders,
            },
        );
        await gm.goto(base + campaign + scene + '?mode=prepare');
        if (process.argv.includes('--restore')) {
            restore = JSON.parse(fs.readFileSync(backup, 'utf8'));
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore prior run first');
        const initial = await snapshot(gm);
        assert.equal(String(initial.id), '10');
        const original = initial.structure.graph;
        const fixture = {
            ...original,
            vertices: [
                ...original.vertices,
                vertex('a', 120, 120),
                vertex('b', 300, 120),
                vertex('c', 300, 210),
                vertex('d', 120, 840),
                vertex('e', 300, 840),
            ],
            edges: [
                ...original.edges,
                edge('top', 'a', 'b'),
                edge('side', 'b', 'c'),
                edge('single', 'd', 'e'),
            ],
            openings: [
                ...original.openings,
                {
                    id: 'qa-door',
                    edgeId: 'qa-top',
                    type: 'door',
                    center: 0.5,
                    width: 42,
                    open: true,
                    locked: false,
                    hinge: 'a',
                    direction: 'left',
                    angle: 90,
                },
                {
                    id: 'qa-window',
                    edgeId: 'qa-side',
                    type: 'window',
                    center: 0.5,
                    width: 26,
                    frame: 'iron',
                    blocksMovement: true,
                    blocksVision: false,
                    blocksLight: false,
                },
            ],
        };
        const active = (await api(gm, campaign)).activeSceneId;
        const seeded = await api(gm, scene + '/structure', 'POST', {
            expected: initial.structure.hash,
            value: fixture,
        });
        restore = { active, original: seeded.structureEdit.before, latest: seeded.structure.hash };
        const record = () => fs.writeFileSync(backup, JSON.stringify(restore));
        record();
        if (String(active) !== '10') await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            { reducedMotion: 'reduce', extraHTTPHeaders },
        );
        for (const page of [gm, player])
            page.on('pageerror', (error) => report.errors.push(error.message));
        await player.goto(base + campaign + '/play');
        await tabletop(player).waitFor();
        await subscribed(player);
        await gm.reload();
        await editor(gm);
        const inspector = gm.getByRole('complementary', { name: 'Inspector Build' });
        const title = (name) => inspector.getByText(name, { exact: true }).waitFor();
        const click = async (p) => gm.mouse.click(...(await point(gm, p)));
        const drag = async (from, to, preview) => {
            const a = await point(gm, from),
                b = await position(gm, to);
            await gm.mouse.move(...a);
            await gm.mouse.down();
            await gm.mouse.move(...b, { steps: 8 });
            if (preview) await preview();
            await gm.mouse.up();
        };
        const altDrag = async (from, to, preview) => {
            await gm.keyboard.down('Alt');
            try {
                await drag(from, to, preview);
            } finally {
                await gm.keyboard.up('Alt');
            }
        };
        let current = await snapshot(gm);
        const save = async (action, endpoint = 'structure') => {
            const pending = gm.waitForResponse(
                (r) =>
                    r.url().endsWith('/api' + scene + '/' + endpoint) &&
                    r.request().method() === 'POST',
                { timeout: 12000 },
            );
            await action();
            const response = await pending;
            const data = await response.json();
            assert.equal(response.status(), 200, JSON.stringify(data));
            restore.latest = data.structure.hash;
            record();
            await gm.locator('.map-editor-status .save-saved').waitFor();
            const next = await snapshot(gm);
            assert.equal(next.structure.hash, restore.latest);
            assert.equal(Number(next.revision), Number(current.revision) + 1);
            current = next;
            return next.structure;
        };

        await align(gm, 0.5, [550, 500]);
        await click([210, 840]);
        await title('Стена');
        const beforeSingle = current.structure;
        const single = await save(() =>
            drag([210, 840], [211, 903], async () => {
                await label(gm, 'Сетка');
                await capture(gm, '01-single-grid-50');
            }),
        );
        assertTranslation(beforeSingle.graph, single.graph, ['qa-d', 'qa-e'], 0, 60);
        assert.equal(
            (await save(() => gm.keyboard.press('Control+z'), 'edit-history')).hash,
            beforeSingle.hash,
        );
        assert.equal(
            (await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history')).hash,
            single.hash,
        );
        check('50%: single wall, grid and live displacement, one revision and exact Undo/Redo.');

        const beforeConnected = current.structure;
        const connected = await save(() => altDrag([153, 120], [153, 100]));
        assertTranslation(beforeConnected.graph, connected.graph, ['qa-a', 'qa-b'], 0, -20);
        assert.deepEqual(xy(connected.graph, 'qa-c'), [300, 210]);
        check(
            '50%: the unselected wall stretches at the shared vertex; its window remains attached.',
        );

        await align(gm, 1, [120, 310]);
        await gm.keyboard.press('Escape');
        await click([155, 100]);
        await gm.keyboard.down('Shift');
        await click([300, 155]);
        await gm.keyboard.up('Shift');
        await title('Стены · 2');
        await gm.keyboard.press('Escape');
        await drag([95, 72], [325, 226], async () => {
            await label(gm, 'Стены · 2');
            await capture(gm, '02-marquee-100');
        });
        await title('Стены · 2');
        await gm.mouse.dblclick(...(await point(gm, [155, 100])));
        await title('Стены · 2');
        const group = await save(() =>
            altDrag([155, 100], [215, 100], async () => {
                await label(gm, 'Δ X');
                await capture(gm, '03-openings-group-100');
            }),
        );
        assertTranslation(connected.graph, group.graph, ['qa-a', 'qa-b', 'qa-c'], 60, 0);
        await button(gm, 'Материал стены').click();
        await inspector.getByRole('searchbox').fill('Fieldstone');
        await button(gm, 'Таверна · Fieldstone walls').click();
        await inspector.getByLabel('Толщина, wu').fill('18');
        const painted = await save(() => button(gm, 'Применить к стенам').click());
        const groupWalls = painted.graph.edges.filter((e) => ['qa-top', 'qa-side'].includes(e.id));
        assert.ok(groupWalls[0].materialVersionId);
        assert.equal(groupWalls[0].materialVersionId, groupWalls[1].materialVersionId);
        assert.ok(groupWalls.every((e) => e.thickness === 18));
        check(
            '100%: Shift, marquee and connected selection, rigid group move with door/window IDs, batch material.',
        );

        const left = painted.graph.rooms.find((room) =>
            room.loop.some((id) => xy(painted.graph, id)[0] === 360),
        );
        assert.ok(left);
        const neighbor = painted.graph.rooms.find(
            (room) =>
                room.id !== left.id && room.loop.filter((id) => left.loop.includes(id)).length >= 2,
        );
        assert.ok(neighbor);
        await gm.mouse.dblclick(...(await point(gm, [440, 240])));
        await title('Комната');
        const movedRoom = await save(() =>
            altDrag([570, 550], [510, 550], async () => {
                await label(gm, 'Δ X');
                await capture(gm, '04-room-shared-wall-100');
            }),
        );
        assertTranslation(painted.graph, movedRoom.graph, left.loop, -60, 0);
        assert.deepEqual(
            current.tokens.map(({ id, x, y }) => ({ id, x, y })),
            initial.tokens.map(({ id, x, y }) => ({ id, x, y })),
        );
        assert.deepEqual(current.props, initial.props);
        await playerDelta(player, movedRoom, left.loop);
        await capture(player, '05-player-realtime');
        assert.equal(
            (await save(() => gm.keyboard.press('Control+z'), 'edit-history')).hash,
            painted.hash,
        );
        assert.equal(
            (await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history')).hash,
            movedRoom.hash,
        );
        check(
            '100%: room translates rigidly, neighboring floors stay linked through shared IDs, Player receives filtered Reverb delta.',
        );

        await altDrag([510, 550], [870, 550], async () => {
            await label(gm, 'одна вершина');
            await capture(gm, '06-rejected-shared-room-100');
        });
        await gm
            .locator('.map-editor-notice')
            .getByText(/одна вершина/)
            .waitFor();
        assert.equal((await snapshot(gm)).structure.hash, movedRoom.hash);
        const occupied = structuredClone(movedRoom.graph);
        const token = initial.tokens.find((token) => token.y > 750);
        assert.ok(token);
        for (const v of occupied.vertices) {
            if (v.id === 'qa-d' || v.id === 'qa-e') {
                v.x = token.x + (v.id === 'qa-d' ? -90 : 90);
                v.y = token.y;
            }
        }
        const failure = await api(
            gm,
            scene + '/structure',
            'POST',
            {
                expected: movedRoom.hash,
                value: occupied,
            },
            422,
        );
        assert.match(failure.message, /занятое токеном/);
        assert.equal((await snapshot(gm)).revision, current.revision);
        await gm.reload();
        await editor(gm);
        assert.equal((await snapshot(gm)).structure.hash, movedRoom.hash);
        check(
            'Invalid shared-room transform and direct token overlap rejected without revision; exact graph survives reload.',
        );

        await align(gm, 1, [120, 310]);
        const connected100 = await save(() => altDrag([215, 100], [215, 80]));
        assertTranslation(movedRoom.graph, connected100.graph, ['qa-a', 'qa-b'], 0, -20);
        await align(gm, 1, [500, 550]);
        const single100 = await save(() => drag([210, 900], [211, 963], () => label(gm, 'Сетка')));
        assertTranslation(connected100.graph, single100.graph, ['qa-d', 'qa-e'], 0, 60);
        await inspector.getByText('Переместить', { exact: true }).click();
        await inspector.getByLabel('Δ Y, wu').fill('-20');
        const precise = await save(() => button(gm, 'Сместить').click());
        assertTranslation(single100.graph, precise.graph, ['qa-d', 'qa-e'], 0, -20);
        check('100%: connected and single-wall drag, grid and exact offset from Inspector.');

        await align(gm, 0.5, [550, 500]);
        await gm.mouse.dblclick(...(await point(gm, [215, 80])));
        await title('Стены · 2');
        const group50 = await save(() =>
            drag([215, 80], [135, 108], async () => {
                await label(gm, 'Выравнивание');
                await capture(gm, '07-alignment-50');
            }),
        );
        assertTranslation(precise.graph, group50.graph, ['qa-a', 'qa-b', 'qa-c'], -80, 30);
        const room50 = await save(() => drag([510, 550], [570, 550], () => label(gm, 'Сетка')));
        assertTranslation(group50.graph, room50.graph, left.loop, 60, 0);
        await playerDelta(player, room50, left.loop);
        await altDrag([210, 940], [token.x, token.y], () => label(gm, 'занятое токеном'));
        await gm
            .locator('.map-editor-notice')
            .getByText(/занятое токеном/)
            .waitFor();
        assert.equal((await snapshot(gm)).structure.hash, room50.hash);
        await gm.reload();
        assert.equal((await snapshot(gm)).structure.hash, room50.hash);
        check(
            '50%: rigid group with openings, alignment snap, room and shared walls, Player delta, blocked token overlap and reload.',
        );
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) {
        if (gm) await capture(gm, 'failure').catch(() => {});
        throw error;
    } finally {
        try {
            if (restore) {
                const current = (await snapshot(gm)).structure;
                if (current.hash !== restore.original.hash) {
                    assert.equal(current.hash, restore.latest, 'Scene changed outside this QA run');
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '10',
                                expected: { hash: current.hash },
                                value: restore.original,
                            },
                        ],
                    });
                }
                assert.equal((await snapshot(gm)).structure.hash, restore.original.hash);
                if (String((await api(gm, campaign)).activeSceneId) !== String(restore.active))
                    await api(gm, campaign + '/activate', 'POST', { sceneId: restore.active });
                assert.equal(
                    String((await api(gm, campaign)).activeSceneId),
                    String(restore.active),
                );
                fs.unlinkSync(backup);
                report.restored = true;
            }
        } finally {
            fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
            await browser.close();
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
