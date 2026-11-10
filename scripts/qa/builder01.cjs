/* eslint-disable @typescript-eslint/no-require-imports -- Local Chromium QA on the existing Scene 10. */
/* global require, process, console, window, document */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, base } = require('./map07a.cjs');

const scene = '/scenes/10';
const campaign = '/campaigns/5';
const out = 'artifacts/builder01';
const backup = out + '/restore.private.json';
const snapshot = (page) => api(page, scene + '/snapshot');
const report = {
    scene: 10,
    browser: null,
    zooms: [],
    checks: [],
    errors: [],
    passed: false,
    restored: false,
};
const check = (label) => {
    report.checks.push(label);
    console.log(label);
};
const button = (page, name) => page.getByRole('button', { name, exact: true });
const camera = (page) =>
    page.evaluate(() => {
        const world = window.tabletopApp.stage.children[0];
        return { x: world.x, y: world.y, zoom: world.scale.x };
    });
async function position(page, x, y) {
    const { x: cx, y: cy, zoom } = await camera(page);
    const box = await tabletop(page).boundingBox();
    return [box.x + cx + x * zoom, box.y + cy + y * zoom];
}
async function move(page, x, y) {
    await page.mouse.move(...(await position(page, x, y)));
}
async function click(page, x, y) {
    const point = await position(page, x, y);
    assert.equal(
        await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, point),
        'CANVAS',
        'Map point obscured at ' + [x, y] + ' / ' + point,
    );
    await page.mouse.click(...point);
}
async function alignCamera(page, zoom, [x, y]) {
    const box = await tabletop(page).boundingBox();
    const center = [box.x + box.width * 0.5, box.y + box.height * 0.51];
    await page.mouse.move(...center);
    for (let i = 0; i < 12; i++) {
        const { zoom: current } = await camera(page);
        if (Math.abs(zoom - current) < 0.001) break;
        await page.mouse.wheel(0, -Math.log(zoom / current) / 0.002);
        await page.waitForTimeout(160);
    }
    assert.ok(Math.abs(zoom - (await camera(page)).zoom) < 0.001);
    const screen = await position(page, x, y);
    const dx = center[0] - screen[0],
        dy = center[1] - screen[1];
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(center[0] + dx, center[1] + dy, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(100);
    const actual = await position(page, x, y);
    assert.ok(
        Math.hypot(actual[0] - center[0], actual[1] - center[1]) < 3,
        'Space-pan alignment: ' + JSON.stringify({ actual, center, dx, dy }),
    );
    report.zooms.push(Math.round((await camera(page)).zoom * 100));
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
        { timeout: 3000 },
    );
}
async function capture(page, name) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: out + '/' + name + '.png' });
}
async function editor(page) {
    await tabletop(page).waitFor({ timeout: 30000 });
    const library = button(page, 'Закрыть библиотеку');
    if (await library.isVisible()) await library.click();
    await button(page, 'Редактировать карту').click();
    await button(page, 'Build').click();
    await page.getByRole('group', { name: 'Инструменты Build' }).waitFor();
}
function worldOpening(graph, opening) {
    const edge = graph.edges.find((e) => e.id === opening.edgeId);
    const a = graph.vertices.find((v) => v.id === edge.a);
    const b = graph.vertices.find((v) => v.id === edge.b);
    return [a.x + (b.x - a.x) * opening.center, a.y + (b.y - a.y) * opening.center];
}
function vertexNear(graph, x, y, tolerance = 1) {
    return graph.vertices.find((v) => Math.hypot(v.x - x, v.y - y) < tolerance);
}
function checkOpenings(before, after) {
    for (const old of before.openings) {
        const next = after.openings.find((o) => o.id === old.id);
        assert.ok(next);
        const a = worldOpening(before, old),
            b = worldOpening(after, next);
        assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01);
        assert.deepEqual({ ...next, center: old.center, edgeId: old.edgeId }, old);
    }
}

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    report.browser = 'Chromium ' + browser.version();
    let gm, saved;
    let lastHash;
    try {
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
            {
                viewport: { width: 1700, height: 1130 },
                reducedMotion: 'reduce',
            },
        );
        gm.on('pageerror', (error) => report.errors.push(error.message));
        if (process.argv.includes('--restore')) {
            saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
            lastHash = saved.lastHash;
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore prior run first');
        await gm.goto(base + campaign + scene + '?mode=prepare');
        const initial = await snapshot(gm);
        saved = { structure: initial.structure, active: (await api(gm, campaign)).activeSceneId };
        assert.ok(saved.structure?.graph.rooms.length >= 3, 'Tavern fixture');
        fs.writeFileSync(backup, JSON.stringify(saved));
        lastHash = initial.structure.hash;
        if (String(saved.active) !== '10')
            await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            { reducedMotion: 'reduce' },
        );
        player.on('pageerror', (error) => report.errors.push(error.message));
        await player.goto(base + campaign + '/play');
        await tabletop(player).waitFor({ timeout: 30000 });
        await player.waitForFunction(() =>
            window.movementFrames.some((frame) => frame.includes('subscription_succeeded')),
        );
        await gm.reload();
        await editor(gm);
        const choose = (name) => button(gm, name).click();
        const inspector = gm.getByRole('complementary', { name: 'Inspector Build' });
        const save = async (action, endpoint = 'structure') => {
            const pending = gm.waitForResponse(
                (r) =>
                    r.url().endsWith('/api' + scene + '/' + endpoint) &&
                    r.request().method() === 'POST',
                { timeout: 11000 },
            );
            await action();
            const response = await pending;
            const data = await response.json();
            assert.equal(response.status(), 200, JSON.stringify(data));
            lastHash = data.structure?.hash ?? (await snapshot(gm)).structure.hash;
            saved.original ??= data.structureEdit?.before;
            saved.lastHash = lastHash;
            fs.writeFileSync(backup, JSON.stringify(saved));
            await gm.locator('.map-editor-status .save-saved').waitFor();
            return (await snapshot(gm)).structure;
        };
        const material = async (type, query, name, shot) => {
            const field = 'Материал ' + type;
            await choose(field);
            const picker = gm.getByRole('region', { name: field });
            await picker.getByRole('searchbox').fill(query);
            const tile = picker.getByRole('button', { name, exact: true });
            await tile.waitFor();
            await tile.locator('.material-preview-status').waitFor({ state: 'hidden' });
            if (shot) await capture(gm, shot);
            await tile.click();
        };

        await alignCamera(gm, 0.5, [500, 430]);
        await choose('Комната');
        assert.equal(await inspector.count(), 0);
        await material(
            'стены',
            'Fieldstone',
            'Таверна · Fieldstone walls',
            '01-wall-material-search-50',
        );
        await material('пола', 'Oak', 'Таверна · Oak planks');
        await choose('Материал пола');
        await gm.getByText('Недавние', { exact: true }).waitFor();
        await capture(gm, '02-recent-floor-materials-50');
        await gm.keyboard.press('Escape');
        await move(gm, 123, 243);
        await label(gm, 'Сетка');
        const added = await save(async () => {
            await click(gm, 123, 243);
            await move(gm, 366, 725);
            await label(gm, 'Вершина');
            await capture(gm, '03-rectangle-preview-50');
            await click(gm, 366, 725);
        });
        assert.equal(added.graph.rooms.length, saved.structure.graph.rooms.length + 1);
        assert.equal(added.graph.edges.length, saved.structure.graph.edges.length + 3);
        assert.ok(vertexNear(added.graph, 120, 240));
        checkOpenings(initial.structure.graph, added.graph);
        await choose('Сегмент');
        await move(gm, 240, 251);
        await label(gm, 'Середина');
        await move(gm, 281, 251);
        await label(gm, 'Ось стены');
        const beforeRoom = await save(() => gm.keyboard.press('Control+z'), 'edit-history');
        assert.equal(beforeRoom.hash, saved.structure.hash);
        const afterRoom = await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
        assert.equal(afterRoom.hash, added.hash);
        check(
            '50%: grid, endpoint, midpoint and axis, visual search and recents, shared wall with original openings, Undo and Redo.',
        );

        await alignCamera(gm, 1, [370, 425]);
        await choose('Дверь');
        const doorState = await save(() => click(gm, 120, 350));
        assert.equal(await inspector.getByText('Дверь', { exact: true }).count(), 1);
        const newDoor = doorState.graph.openings.find(
            (o) => !added.graph.openings.some((v) => v.id === o.id),
        );
        assert.equal(newDoor.type, 'door');
        const opened = await save(() => choose('Открыть дверь'));
        assert.equal(opened.graph.openings.find((o) => o.id === newDoor.id).open, true);
        await choose('Окно');
        const windowState = await save(() => click(gm, 120, 610));
        assert.equal(await inspector.getByText('Окно', { exact: true }).count(), 1);
        const newWindow = windowState.graph.openings.find(
            (o) => !opened.graph.openings.some((v) => v.id === o.id),
        );
        assert.equal(newWindow.type, 'window');
        await capture(gm, '04-window-inspector-100');

        await choose('Сегмент');
        await move(gm, 114, 482);
        await label(gm, 'Середина');
        await capture(gm, '05-midpoint-100');
        await click(gm, 114, 482);
        await move(gm, 52, 497);
        await gm.keyboard.down('Shift');
        await label(gm, 'Горизонталь · Shift');
        await capture(gm, '06-shift-guide-100');
        const split = await save(() => click(gm, 52, 497));
        await gm.keyboard.up('Shift');
        const junction = vertexNear(split.graph, 120, 480);
        assert.ok(junction);
        assert.equal(
            split.graph.edges.filter((e) => e.a === junction.id || e.b === junction.id).length,
            3,
        );
        assert.ok(vertexNear(split.graph, 52, 480, 2));
        assert.ok(
            [newDoor, newWindow].some(
                (original) =>
                    split.graph.openings.find((o) => o.id === original.id).edgeId !==
                    original.edgeId,
            ),
        );
        checkOpenings(windowState.graph, split.graph);
        check(
            '100%: door opening and window insertion, midpoint T-junction, Shift direction lock, aperture IDs and world positions survive the split.',
        );

        const reverted = await save(() => gm.keyboard.press('Control+z'), 'edit-history');
        assert.equal(reverted.hash, windowState.hash);
        const redone = await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
        assert.equal(redone.hash, split.hash);
        check('Undo and Redo restore identical server graph hashes, including both apertures.');

        await move(gm, 354, 481);
        await label(gm, 'Середина');
        await click(gm, 354, 481);
        await click(gm, 288, 480);
        await gm.getByText('Разрез слишком близко к проёму.', { exact: true }).waitFor();
        assert.equal((await snapshot(gm)).structure.hash, split.hash);
        await button(gm, 'Скрыть подсказку').click();

        await choose('Контур');
        await material('пола', 'flagstone', 'Таверна · Kitchen flagstone');
        await click(gm, 120, 240);
        await move(gm, 121, 483);
        await label(gm, 'Вершина');
        // A second room shares the existing subdivided vertical side at x=120.
        // Its west side stays beyond the end of the short T-branch.
        await click(gm, 120, 720);
        await click(gm, 20, 720);
        await click(gm, 20, 240);
        const annex = await save(() => gm.keyboard.press('Enter'));
        assert.ok(
            annex.graph.rooms.some(
                (r) => r.loop.includes(junction.id) && r.materialVersionId === '61',
            ),
        );
        assert.equal(annex.graph.rooms.length, added.graph.rooms.length + 1);
        checkOpenings(split.graph, annex.graph);
        check('Second room reuses the subdivided shared wall and a different floor material.');

        await choose('Стены');
        await move(gm, 240, 246);
        await label(gm, 'Середина');
        await click(gm, 240, 246);
        await move(gm, 240, 155);
        await label(gm, 'Вертикаль');
        await click(gm, 240, 155);
        await move(gm, 303, 92);
        await label(gm, 'Диагональ');
        await gm.keyboard.down('Alt');
        await label(gm, 'Без привязки');
        await move(gm, 304, 96);
        await click(gm, 304, 96);
        await gm.keyboard.up('Alt');
        await move(gm, 326, 47);
        await gm.keyboard.press('Escape');
        assert.equal((await snapshot(gm)).structure.hash, annex.hash);
        check(
            'Vertical and diagonal guides, Alt bypass without moving the cursor, Esc discards the path.',
        );

        await choose('Сегмент');
        await move(gm, 257, 246);
        await label(gm, 'Ось стены');
        await click(gm, 257, 246);
        await move(gm, 296, 170);
        const axis = await save(() => click(gm, 296, 170));
        assert.ok(vertexNear(axis.graph, 257, 240, 2));
        const end = vertexNear(axis.graph, 296, 170, 2);
        assert.ok(end);
        await choose('Стены');
        await click(gm, end.x, end.y);
        // Relative parallel/perpendicular from the incident non-axis wall.
        await move(gm, end.x + 30, end.y - 59);
        await label(gm, 'Параллель');
        await move(gm, end.x + 64, end.y + 33);
        await label(gm, 'Перпендикуляр');
        await capture(gm, '07-relative-guide-100');
        const continued = await save(async () => {
            await click(gm, end.x + 64, end.y + 33);
            await gm.keyboard.press('Enter');
        });
        assert.equal(
            continued.graph.edges.filter((e) => e.a === end.id || e.b === end.id).length,
            2,
        );
        check(
            'Axis snap splits a wall. Relative parallel and perpendicular guides continue from the same endpoint.',
        );

        await choose('Правка');
        await click(gm, 175, 320);
        await inspector.getByText('Комната', { exact: true }).waitFor();
        await material('пола', 'flagstone', 'Таверна · Kitchen flagstone');
        const painted = await save(() => choose('Применить пол'));
        assert.equal(
            painted.graph.rooms.filter((r) => r.materialVersionId === '61').length,
            axis.graph.rooms.filter((r) => r.materialVersionId === '61').length + 1,
        );
        await capture(gm, '08-room-inspector-100');
        await gm.reload();
        assert.equal((await snapshot(gm)).structure.hash, painted.hash);
        check('Inspector material change saves and survives reload.');
        const playerGraph = (await snapshot(player)).structure;
        assert.equal(playerGraph.graph.edges.length, painted.graph.edges.length);
        assert.ok(playerGraph.graph.edges.every((e) => !('blocksVision' in e)));
        assert.ok(playerGraph.graph.openings.every((o) => !('locked' in o)));
        assert.ok(playerGraph.materials.every((m) => !('name' in m)));
        const patchHandle = await player.waitForFunction(
            (hash) => {
                for (const raw of window.movementFrames) {
                    const frame = JSON.parse(raw);
                    if (frame.event !== 'tabletop') continue;
                    const event =
                        typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    const patch = event?.payload?.structurePatch;
                    if (event?.sceneId === '10' && patch?.hash === hash)
                        return { type: event.type, patch };
                }
            },
            playerGraph.hash,
            { timeout: 7000 },
        );
        const { type, patch } = await patchHandle.jsonValue();
        assert.ok(['vision.updated', 'structure.updated'].includes(type));
        assert.ok(patch.rooms.upsert.some((room) => room.materialVersionId === '61'));
        assert.doesNotMatch(
            JSON.stringify(patch),
            /"blocksVision"|"blocksLight"|"blocksMovement"|"locked"|"name"/,
        );
        check(
            'Player gets the matching material change over Reverb (' +
                type +
                ') and a filtered snapshot.',
        );
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) {
        if (gm) {
            await capture(gm, 'failure').catch(() => {});
            console.error(
                'Notices:',
                await gm
                    .locator('.map-editor-notice')
                    .allTextContents()
                    .catch(() => []),
            );
        }
        throw error;
    } finally {
        try {
            if (saved) {
                const current = (await snapshot(gm)).structure;
                if (current.hash !== saved.structure.hash) {
                    if (lastHash)
                        assert.equal(current.hash, lastHash, 'Scene changed outside this QA run');
                    assert.ok(saved.original, 'Missing the original encrypted history snapshot');
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '10',
                                expected: { hash: current.hash },
                                value: saved.original,
                            },
                        ],
                    });
                }
                assert.equal((await snapshot(gm)).structure.hash, saved.structure.hash);
                if (String((await api(gm, campaign)).activeSceneId) !== String(saved.active))
                    await api(gm, campaign + '/activate', 'POST', { sceneId: saved.active });
                assert.equal(String((await api(gm, campaign)).activeSceneId), String(saved.active));
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
