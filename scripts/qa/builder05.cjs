/* eslint-disable @typescript-eslint/no-require-imports -- Reversible Chromium QA of the existing Scene 10. */
/* global require, process, console, window, document */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');
const scene = '/scenes/10',
    campaign = '/campaigns/5',
    out = 'artifacts/builder05';
const backup = out + '/restore.private.json';
const extraHTTPHeaders = { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' };
const snapshot = (page) => api(page, scene + '/snapshot');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const report = { scene: 10, checks: [], errors: [], passed: false, restored: false };
const check = (s) => {
    report.checks.push(s);
    console.log(s);
};
const camera = (page) =>
    page.evaluate(() => {
        const world = window.tabletopApp.stage.children[0];
        return { x: world.x, y: world.y, zoom: world.scale.x };
    });
async function position(page, [x, y]) {
    const view = await camera(page),
        box = await tabletop(page).boundingBox();
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
    const box = await tabletop(page).boundingBox(),
        center = [box.x + box.width * 0.5, box.y + box.height * 0.5];
    await page.mouse.move(...center);
    for (let i = 0; i < 12; i++) {
        const current = (await camera(page)).zoom;
        if (Math.abs(current - zoom) < 0.001) break;
        await page.mouse.wheel(0, -Math.log(zoom / current) / 0.002);
        await page.waitForTimeout(120);
    }
    const screen = await position(page, world);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(2 * center[0] - screen[0], 2 * center[1] - screen[1], { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    assert.ok(Math.abs((await camera(page)).zoom - zoom) < 0.001);
}
async function label(page, text) {
    await page.waitForFunction(
        (text) => {
            const find = (n) =>
                (n.visible && typeof n.text === 'string' && n.text.includes(text)) ||
                (n.children ?? []).some(find);
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
}
const v = (id, x, y) => ({ id: 'qa5-' + id, x, y });
const edge = (id, a, b) => ({
    id: 'qa5-' + id,
    a: 'qa5-' + a,
    b: 'qa5-' + b,
    thickness: 14,
    materialVersionId: null,
    blocksMovement: true,
    blocksVision: true,
    blocksLight: true,
});
function translation(before, after, ids, dx, dy) {
    for (const a of before.vertices.filter((v) => ids.includes(v.id))) {
        const b = after.vertices.find((v) => v.id === a.id);
        assert.ok(b, a.id);
        assert.ok(
            Math.abs(b.x - a.x - dx) < 0.002 && Math.abs(b.y - a.y - dy) < 0.002,
            'Rigid translation ' + a.id,
        );
    }
}
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.browser = 'Chromium ' + browser.version();
    let gm, restore;
    const record = () => fs.writeFileSync(backup, JSON.stringify(restore));
    const capture = (name) => gm.screenshot({ path: out + '/' + name + '.png' });
    try {
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
            { viewport: { width: 1700, height: 1130 }, reducedMotion: 'reduce', extraHTTPHeaders },
        );
        await gm.goto(base + campaign + scene + '?mode=prepare');
        if (process.argv.includes('--restore')) {
            restore = JSON.parse(fs.readFileSync(backup, 'utf8'));
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore prior run first');
        const initial = await snapshot(gm),
            original = initial.structure.graph;
        const fixture = {
            ...original,
            vertices: [
                ...original.vertices,
                v('a', 100, 300),
                v('b', 280, 300),
                v('c', 280, 430),
                v('d', 240, 500),
                v('e', 100, 500),
                v('w1', 100, 900),
                v('w2', 500, 900),
                v('g1', 100, 100),
                v('g2', 240, 140),
                v('g3', 270, 200),
            ],
            edges: [
                ...original.edges,
                edge('ab', 'a', 'b'),
                edge('bc', 'b', 'c'),
                edge('cd', 'c', 'd'),
                edge('de', 'd', 'e'),
                edge('ea', 'e', 'a'),
                edge('wall', 'w1', 'w2'),
                edge('g12', 'g1', 'g2'),
                edge('g23', 'g2', 'g3'),
            ],
            openings: [
                ...(original.openings ?? []),
                {
                    id: 'qa5-door',
                    edgeId: 'qa5-wall',
                    type: 'door',
                    center: 0.15,
                    width: 32,
                    open: false,
                    locked: false,
                    hinge: 'a',
                    direction: 'left',
                    angle: 90,
                },
            ],
        };
        const active = (await api(gm, campaign)).activeSceneId;
        const seeded = await api(gm, scene + '/structure', 'POST', {
            expected: initial.structure.hash,
            value: fixture,
        });
        restore = { active, original: seeded.structureEdit.before, latest: seeded.structure.hash };
        record();
        if (String(active) !== '10') await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            { extraHTTPHeaders },
        );
        for (const page of [gm, player]) page.on('pageerror', (e) => report.errors.push(e.message));
        await player.goto(base + campaign + '/play');
        await tabletop(player).waitFor();
        await subscribed(player);
        await gm.reload();
        await editor(gm);
        const inspector = gm.getByRole('complementary', { name: 'Inspector Build' });
        const choose = (name) => button(gm, name).click();
        const click = async (p) => gm.mouse.click(...(await point(gm, p)));
        const drag = async (a, b, modifiers = [], preview) => {
            await gm.mouse.move(...(await point(gm, a)));
            for (const key of modifiers) await gm.keyboard.down(key);
            try {
                await gm.mouse.down();
                await gm.mouse.move(...(await position(gm, b)), { steps: 8 });
                if (preview) await preview();
                await gm.mouse.up();
            } finally {
                for (const key of [...modifiers].reverse()) await gm.keyboard.up(key);
            }
        };
        let current = await snapshot(gm);
        const save = async (action, endpoint = 'structure') => {
            const pending = gm
                .waitForResponse(
                    (r) =>
                        r.url().endsWith('/api' + scene + '/' + endpoint) &&
                        r.request().method() === 'POST',
                    { timeout: 12000 },
                )
                .catch((e) => e);
            await action();
            const response = await pending;
            if (response instanceof Error) throw response;
            const data = await response.json();
            assert.equal(response.status(), 200, JSON.stringify(data));
            restore.latest = data.structure.hash;
            record();
            await gm.locator('.map-editor-status .save-saved').waitFor();
            const next = await snapshot(gm);
            assert.equal(Number(next.revision), Number(current.revision) + 1);
            assert.equal(next.structure.hash, restore.latest);
            current = next;
            return next.structure;
        };
        const undo = (hash) =>
            save(() => gm.keyboard.press('Control+z'), 'edit-history').then((s) =>
                assert.equal(s.hash, hash),
            );
        const redo = (hash) =>
            save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history').then((s) =>
                assert.equal(s.hash, hash),
            );
        const material = async (tile) => {
            await choose('Материал пола');
            const picker = gm.getByRole('region', { name: 'Материал пола', exact: true });
            const target = picker
                .locator('.build-material-grid')
                .last()
                .locator('button.build-material-tile[aria-label]')
                .nth(tile);
            const name = await target.getAttribute('aria-label');
            await target.click();
            return name;
        };
        const playerDelta = async () => {
            const projected = (await snapshot(player)).structure;
            await player.waitForFunction(
                (hash) =>
                    window.movementFrames.some((raw) => {
                        try {
                            const frame = JSON.parse(raw),
                                e =
                                    typeof frame.data === 'string'
                                        ? JSON.parse(frame.data)
                                        : frame.data;
                            return (
                                String(e.sceneId) === '10' &&
                                e.payload?.structurePatch?.hash === hash
                            );
                        } catch {
                            return false;
                        }
                    }),
                projected.hash,
                { timeout: 10000 },
            );
            const events = await player.evaluate(() =>
                window.movementFrames.flatMap((raw) => {
                    try {
                        const f = JSON.parse(raw);
                        return f.event === 'tabletop'
                            ? [typeof f.data === 'string' ? JSON.parse(f.data) : f.data]
                            : [];
                    } catch {
                        return [];
                    }
                }),
            );
            const patches = events.flatMap((e) =>
                e.payload?.structurePatch ? [e.payload.structurePatch] : [],
            );
            assert.ok(
                !/"structureEdit"|"blocksVision"|"blocksLight"|"locked"/.test(
                    JSON.stringify(patches),
                ),
                'Player structural patch contains secret metadata',
            );
            assert.equal(projected.graph.rooms.length, current.structure.graph.rooms.length);
        };

        await align(gm, 0.5, [190, 400]);
        await choose('Пол');
        await material(0);
        await gm.mouse.move(...(await point(gm, [190, 400])));
        await label(gm, 'залить пол');
        await capture('01-floor-preview-50');
        const unpainted = current.structure.hash;
        const filled = await save(() => click([190, 400]));
        assert.equal(filled.graph.rooms.length, original.rooms.length + 1);
        const paintedRoom = filled.graph.rooms.find((r) => r.loop.includes('qa5-a'));
        assert.ok(paintedRoom.materialVersionId);
        await undo(unpainted);
        await redo(filled.hash);
        const parentMaterialName = await material(1);
        const changed = await save(() => click([190, 400]));
        assert.notEqual(
            changed.graph.rooms.find((r) => r.id === paintedRoom.id).materialVersionId,
            paintedRoom.materialVersionId,
        );
        assert.equal(changed.graph.rooms.length, filled.graph.rooms.length);
        await playerDelta();
        check(
            '50%: wall-only enclosure preview, fill from visual library, material replacement, exact Undo/Redo and filtered Player realtime.',
        );

        await choose('Правка');
        await click([190, 400]);
        const roomIds = paintedRoom.loop;
        for (const zoom of [0.5, 1]) {
            await align(gm, zoom, [190, 400]);
            for (const [name, anchor] of [
                ['center', [190, 400]],
                ['corner', [100, 300]],
                ['side', [190, 300]],
                ['contour', [240, 500]],
                ['bounds-corner', [280, 500]],
            ]) {
                await click([190, 400]);
                const before = current.structure;
                const moved = await save(() =>
                    drag(anchor, [anchor[0] + 12, anchor[1] + 18], ['Alt'], async () => {
                        await label(gm, 'Δ X');
                        if (name === 'contour') await capture('02-room-contour-' + zoom * 100);
                    }),
                );
                translation(before.graph, moved.graph, roomIds, 12, 18);
                assert.deepEqual(moved.graph.openings, before.graph.openings);
                await undo(before.hash);
            }
            await click([190, 400]);
            const before = current.structure;
            const shifted = await save(() =>
                drag([190, 400], [262, 455], ['Shift', 'Alt'], () => label(gm, '45°')),
            );
            translation(before.graph, shifted.graph, roomIds, 63.5, 63.5);
            await undo(before.hash);
        }
        check(
            '50/100%: room center, bounding corners, side midpoints and actual contour points; rigid Shift 45° + Alt preview and exact history.',
        );

        await align(gm, 1, [190, 400]);
        await click([190, 400]);
        await inspector.getByText('Переместить', { exact: true }).click();
        await inspector.getByLabel('Позиционирование').selectOption('absolute');
        await inspector.getByLabel('X, wu', { exact: true }).fill('201.125');
        await inspector.getByLabel('Y, wu', { exact: true }).fill('409.375');
        const beforeExact = current.structure;
        const exact = await save(() => choose('Поставить точно'));
        translation(beforeExact.graph, exact.graph, roomIds, 11.125, 9.375);
        await undo(beforeExact.hash);
        await click([190, 400]);
        await inspector.getByText('Переместить', { exact: true }).click();
        await inspector.getByLabel('Δ X, wu').fill('-200');
        const invalidHash = current.structure.hash,
            invalidRevision = current.revision;
        await choose('Сместить');
        await gm
            .locator('.map-editor-notice')
            .getByText(/границы/)
            .waitFor();
        assert.equal((await snapshot(gm)).revision, invalidRevision);
        assert.equal((await snapshot(gm)).structure.hash, invalidHash);
        check(
            'Absolute anchor coordinates keep 0.001 wu precision; invalid bounds rejected without revision.',
        );

        await align(gm, 1, [185, 250]);
        await gm.mouse.dblclick(...(await point(gm, [170, 120])));
        await inspector.getByText('Стены · 2', { exact: true }).waitFor();
        const beforeGroup = current.structure;
        const group = await save(() =>
            drag([185, 150], [187, 348], [], async () => {
                await label(gm, 'Вершина');
                await capture('03-group-vertex-snap-100');
            }),
        );
        translation(beforeGroup.graph, group.graph, ['qa5-g2', 'qa5-g3'], 0, 200);
        assert.equal(group.graph.vertices.filter((v) => v.x === 100 && v.y === 300).length, 1);
        for (const e of beforeGroup.graph.edges)
            assert.ok(group.graph.edges.some((n) => n.id === e.id));
        await playerDelta();
        await undo(beforeGroup.hash);
        check(
            'Connected group moves by center, snaps to a stationary corner and welds endpoints without deleting either wall.',
        );

        await align(gm, 1, [190, 400]);
        await choose('Сегмент');
        await save(() => drag([190, 300], [190, 500], ['Alt']));
        await choose('Пол');
        const subMaterialName = await material(0);
        await gm.mouse.move(...(await point(gm, [140, 400])));
        await label(gm, 'залить пол');
        const beforePartitionFill = current.structure.hash;
        const partitioned = await save(() => click([140, 400]));
        assert.equal(partitioned.graph.rooms.length, original.rooms.length + 2);
        const subroom = partitioned.graph.rooms.find(
            (r) => r.id !== paintedRoom.id && r.loop.includes('qa5-a'),
        );
        assert.ok(subroom);
        assert.ok(
            subroom.loop.every(
                (id) => partitioned.graph.vertices.find((v) => v.id === id).x <= 190,
            ),
        );
        await undo(beforePartitionFill);
        await redo(partitioned.hash);
        await gm.waitForTimeout(700);
        await capture('04-floor-subregion-100');
        await playerDelta();
        await choose('Правка');
        await click([140, 400]);
        assert.equal(
            await inspector
                .getByRole('button', { name: 'Материал пола', exact: true })
                .locator('strong')
                .textContent(),
            subMaterialName,
        );
        await capture('05-subregion-inspector');
        await click([240, 400]);
        assert.equal(
            await inspector
                .getByRole('button', { name: 'Материал пола', exact: true })
                .locator('strong')
                .textContent(),
            parentMaterialName,
        );
        check(
            'Partition face paints independently above the original floor, keeps the enclosing room and replays exactly.',
        );

        await choose('Правка');
        await align(gm, 1, [300, 900]);
        await click([300, 900]);
        const beforeGrid = current.structure;
        const grid = await save(() => drag([300, 900], [301, 962], [], () => label(gm, 'Сетка')));
        translation(beforeGrid.graph, grid.graph, ['qa5-w1', 'qa5-w2'], 0, 60);
        await undo(beforeGrid.hash);

        const segment = async (a, b) => {
            await choose('Сегмент');
            return save(() => drag(a, b, ['Alt']));
        };
        const beforeCross = current.structure.hash;
        const firstCross = await segment([250, 840], [330, 960]);
        await undo(beforeCross);
        await redo(firstCross.hash);
        let joint = current.structure.graph.vertices.find(
            (v) => Math.abs(v.x - 290) < 0.01 && v.y === 900,
        );
        assert.ok(joint);
        assert.equal(
            current.structure.graph.edges.filter((e) => e.a === joint.id || e.b === joint.id)
                .length,
            4,
        );
        await segment([410, 900], [460, 980]);
        joint = current.structure.graph.vertices.find((v) => v.x === 410 && v.y === 900);
        assert.equal(
            current.structure.graph.edges.filter((e) => e.a === joint.id || e.b === joint.id)
                .length,
            3,
        );
        await segment([180, 960], [420, 840]);
        const finalCross = current.structure;
        const door = finalCross.graph.openings.find((o) => o.id === 'qa5-door');
        const wall = finalCross.graph.edges.find((e) => e.id === door.edgeId);
        const vertices = Object.fromEntries(finalCross.graph.vertices.map((v) => [v.id, v]));
        assert.ok(
            Math.abs(
                vertices[wall.a].x + (vertices[wall.b].x - vertices[wall.a].x) * door.center - 160,
            ) < 0.002,
        );
        for (const e of fixture.edges) assert.ok(finalCross.graph.edges.some((n) => n.id === e.id));
        await capture('04-multiple-t-x-junctions');
        await playerDelta();
        check(
            'Grid translation and arbitrary-angle T/X drawing split all axes; original wall IDs and door position preserved.',
        );

        await choose('Сегмент');
        await drag([160, 840], [160, 960], ['Alt']);
        await gm
            .locator('.map-editor-notice')
            .getByText(/Разрез слишком близко/)
            .waitFor();
        assert.equal((await snapshot(gm)).structure.hash, finalCross.hash);
        const bad = {
            ...finalCross.graph,
            vertices: [...finalCross.graph.vertices, v('bad-a', 160, 840), v('bad-b', 160, 960)],
            edges: [...finalCross.graph.edges, edge('bad', 'bad-a', 'bad-b')],
        };
        await api(gm, scene + '/structure', 'POST', { expected: finalCross.hash, value: bad }, 422);
        await api(
            gm,
            scene + '/structure',
            'POST',
            { expected: initial.structure.hash, value: finalCross.graph },
            409,
        );
        assert.equal((await snapshot(gm)).structure.hash, finalCross.hash);
        await gm.reload();
        await editor(gm);
        assert.equal((await snapshot(gm)).structure.hash, finalCross.hash);
        await player.reload();
        await tabletop(player).waitFor();
        assert.equal(
            (await snapshot(player)).structure.graph.edges.length,
            finalCross.graph.edges.length,
        );
        check(
            'Opening collision rejected in live gesture and direct backend request; stale write rejected; GM and Player reload preserve graph.',
        );
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) {
        report.failure = error.message;
        if (gm) await capture('failure').catch(() => {});
        throw error;
    } finally {
        try {
            if (restore) {
                const current = (await snapshot(gm)).structure;
                if (current.hash !== restore.original.hash) {
                    assert.equal(current.hash, restore.latest, 'Scene changed outside QA');
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
                fs.unlinkSync(backup);
                report.restored = true;
            }
        } finally {
            fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
            await browser.close();
        }
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
