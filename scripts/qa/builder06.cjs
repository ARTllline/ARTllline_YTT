/* eslint-disable @typescript-eslint/no-require-imports -- Chromium acceptance on the user-requested existing Scene 10. */
/* global require, module, process, console, window, Buffer */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');
const scene = '/scenes/10',
    campaign = '/campaigns/5',
    out = 'artifacts/builder06';
const backup = out + '/restore.private.json';
const report = { scene: 10, checks: [], errors: [], passed: false };
const check = (text) => {
    report.checks.push(text);
    console.log(text);
};
const button = (p, name) => p.getByRole('button', { name, exact: true });
const snapshot = (p) => api(p, scene + '/snapshot');
async function camera(p) {
    return p.evaluate(() => {
        const w = window.tabletopApp.stage.children[0];
        return { x: w.x, y: w.y, zoom: w.scale.x };
    });
}
async function position(p, [x, y]) {
    const c = await camera(p),
        b = await tabletop(p).boundingBox();
    return [b.x + c.x + x * c.zoom, b.y + c.y + y * c.zoom];
}
async function align(p, zoom, world) {
    const b = await tabletop(p).boundingBox(),
        center = [b.x + b.width * 0.5, b.y + b.height * 0.5];
    await p.mouse.move(...center);
    for (let i = 0; i < 12; i++) {
        const current = (await camera(p)).zoom;
        if (Math.abs(current - zoom) < 0.001) break;
        await p.mouse.wheel(0, -Math.log(zoom / current) / 0.002);
        await p.waitForTimeout(120);
    }
    const screen = await position(p, world);
    await p.keyboard.down('Space');
    await p.mouse.down();
    await p.mouse.move(2 * center[0] - screen[0], 2 * center[1] - screen[1], { steps: 6 });
    await p.mouse.up();
    await p.keyboard.up('Space');
}
async function editor(p) {
    await tabletop(p).waitFor();
    const close = button(p, 'Закрыть библиотеку');
    if (await close.isVisible()) await close.click();
    await button(p, 'Редактировать карту').click();
    await button(p, 'Build').click();
}
function lit(field, id, [x, y]) {
    const source = field.sources.find((s) => s.id === id);
    assert.ok(source);
    let bits = Buffer.from(
        source.mask.startsWith('~') ? source.mask.slice(1) : source.mask,
        'base64',
    );
    if (source.mask.startsWith('~')) {
        const chunks = [];
        for (let i = 0; i < bits.length; i += 3)
            chunks.push(Buffer.alloc(bits.readUInt16LE(i), bits[i + 2]));
        bits = Buffer.concat(chunks);
    }
    const index = Math.floor(y / field.cellSize) * field.width + Math.floor(x / field.cellSize);
    return !!(bits[index >> 3] & (1 << (index & 7)));
}
module.exports = { align, editor, position, lit };
if (require.main === module)
    (async () => {
        fs.mkdirSync(out, { recursive: true });
        const accounts = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        const browser = await chromium.launch({ channel: 'chrome', headless: true });
        report.browser = 'Chromium ' + browser.version();
        let gm, restore, current;
        const record = () => fs.writeFileSync(backup, JSON.stringify(restore));
        try {
            gm = await login(
                browser,
                accounts.find((a) => a.id === 1),
                {
                    viewport: { width: 1700, height: 1130 },
                    reducedMotion: 'reduce',
                    extraHTTPHeaders: { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' },
                },
            );
            await gm.goto(base + campaign + scene + '?mode=prepare');
            if (process.argv.includes('--restore')) {
                restore = JSON.parse(fs.readFileSync(backup, 'utf8'));
                return;
            }
            assert.ok(!fs.existsSync(backup), 'Restore interrupted QA first');
            current = await snapshot(gm);
            restore = {
                active: (await api(gm, campaign)).activeSceneId,
                originalHash: current.structure.hash,
                latest: current.structure.hash,
                lighting: current.lighting,
                tokens: current.tokens.map((t) => ({ id: t.id, x: t.x, y: t.y })),
            };
            record();
            if (String(restore.active) !== '10')
                await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
            const player = await login(
                browser,
                accounts.find((a) => a.id === 2),
                {
                    reducedMotion: 'reduce',
                    extraHTTPHeaders: { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' },
                },
            );
            await player.goto(base + campaign + '/play');
            await tabletop(player).waitFor();
            await subscribed(player);
            for (const p of [gm, player]) p.on('pageerror', (e) => report.errors.push(e.message));
            await editor(gm);
            await align(gm, 0.5, [650, 500]);
            const choose = (name) => button(gm, name).click();
            const capture = (name) => gm.screenshot({ path: out + '/' + name + '.png' });
            const drag = async (a, b) => {
                await gm.keyboard.down('Alt');
                await gm.mouse.move(...(await position(gm, a)));
                await gm.mouse.down();
                await gm.mouse.move(...(await position(gm, b)), { steps: 8 });
                await gm.mouse.up();
                await gm.keyboard.up('Alt');
            };
            const click = async (p) => gm.mouse.click(...(await position(gm, p)));
            const save = async (action, endpoint = 'structure') => {
                const pending = gm.waitForResponse(
                    (r) =>
                        r.url().endsWith('/api' + scene + '/' + endpoint) &&
                        r.request().method() === 'POST',
                    { timeout: 15000 },
                );
                await action();
                const response = await pending,
                    data = await response.json();
                assert.equal(response.status(), 200, data.message ?? JSON.stringify(data.errors));
                restore.original ??= data.structureEdit?.before;
                restore.latest = data.structure.hash;
                record();
                await gm.locator('.map-editor-status .save-saved').waitFor();
                current = await snapshot(gm);
                assert.equal(
                    current.structure.hash,
                    data.structure.hash,
                    'MySQL roundtrip must preserve the structure hash',
                );
                return current.structure;
            };
            const proposal = gm.getByRole('group', { name: 'Пересечение помещений', exact: true });
            // Add a rectangular extension to the existing tavern, retaining all original floors and openings.
            await choose('Комната');
            await choose('Материал пола');
            await gm
                .getByRole('region', { name: 'Материал пола' })
                .locator('button.build-material-tile[aria-label]')
                .first()
                .click();
            await drag([900, 690], [1100, 900]);
            await proposal.waitFor();
            await choose('Оставить перегородку');
            await capture('01-partition-preview');
            await choose('Обрезать пересекающуюся часть');
            await capture('02-trim-preview');
            assert.equal(await proposal.locator('[role=alert]').count(), 0);
            const trimmed = await save(() => choose('Применить соединение'));
            assert.equal(trimmed.graph.assemblies[0].sources.at(-1).mode, 'trim');
            await save(() => gm.keyboard.press('Control+z'), 'edit-history');
            await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
            check(
                'Existing tavern: rectangular overlap, live partition/trim choices, atomic Undo/Redo.',
            );
            // Circle centered on a straight wall: its inner half is removed by the union.
            await choose('Круг');
            await drag([360, 340], [435, 340]);
            await proposal.waitFor();
            await choose('Объединить помещения');
            await capture('03-semicircle-preview');
            const round = await save(() => choose('Применить соединение'));
            const circleSource = round.graph.assemblies[0].sources.at(-1),
                circleGroup = circleSource.graph.edges[0].curve.group;
            assert.equal(round.graph.edges.filter((e) => e.curve?.group === circleGroup).length, 2);
            await choose('Овал');
            await drag([590, 240], [650, 155]);
            await proposal.waitFor();
            await choose('Объединить помещения');
            const oval = await save(() => choose('Применить соединение'));
            const ovalGroup = oval.graph.assemblies[0].sources.at(-1).graph.edges[0].curve.group;
            assert.ok(oval.graph.floors.length >= 6);
            assert.ok(
                oval.graph.assemblies[0].sources
                    .slice(0, 3)
                    .every((s) => s.graph.rooms[0].materialVersionId),
            );
            check(
                'Semicircular and oval annexes preserve parametric sources, floor materials and the original partitions.',
            );
            await choose('Правка');
            await click([285, 340]);
            const inspector = gm.getByRole('complementary', { name: 'Inspector Build' });
            await inspector
                .getByRole('spinbutton', { name: 'Радиус X, wu', exact: true })
                .fill('85');
            await save(() =>
                inspector.getByRole('button', { name: 'Применить форму', exact: true }).click(),
            );
            // On a visible arc, not on one of its seam vertices.
            await choose('Дверь');
            const doorPoint = [360 - 85 / Math.sqrt(2), 340 + 85 / Math.sqrt(2)];
            const doorGraph = await save(() => click(doorPoint));
            const door = doorGraph.graph.openings.find(
                (o) => !oval.graph.openings?.some((old) => old.id === o.id),
            );
            assert.ok(door);
            await choose('Окно');
            const windowPoint = [590 + 60 / Math.sqrt(2), 240 - 85 / Math.sqrt(2)];
            const windowGraph = await save(() => click(windowPoint));
            const windowOpening = windowGraph.graph.openings.find(
                (o) => !doorGraph.graph.openings.some((old) => old.id === o.id),
            );
            assert.ok(windowOpening);
            await choose('Правка');
            await click([275, 340]);
            await inspector
                .getByRole('spinbutton', { name: 'Радиус X, wu', exact: true })
                .fill('90');
            const resized = await save(() =>
                inspector.getByRole('button', { name: 'Применить форму', exact: true }).click(),
            );
            assert.ok(
                resized.graph.openings.some((o) => o.id === door.id && o.width === door.width),
            );
            await save(() => gm.keyboard.press('Control+z'), 'edit-history');
            await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
            await capture('04-assembled-building-50');
            await align(gm, 1, [330, 340]);
            await capture('05-curved-door-100');
            check(
                'Curved door and oval window, radius edit after union, aperture identity, Undo/Redo at 50/100%.',
            );
            const finalHash = current.structure.hash;
            await gm.reload();
            await editor(gm);
            assert.equal((await snapshot(gm)).structure.hash, finalHash);
            const publicGraph = (await snapshot(player)).structure.graph;
            assert.ok(!publicGraph.assemblies);
            assert.ok(publicGraph.floors.length >= 6);
            assert.ok(publicGraph.edges.some((e) => e.curve?.group === ovalGroup));
            assert.ok(
                publicGraph.edges.every((e) => !('blocksVision' in e) && !('blocksLight' in e)),
            );
            await player.reload();
            await tabletop(player).waitFor();
            const los = await api(gm, scene + '/los', 'POST', {
                observer: { point: { x: 390, y: 340 } },
                targets: [{ point: { x: 300, y: 340 } }, { point: { x: 240, y: 340 } }],
            });
            assert.equal(los.results[0].visible, true);
            assert.equal(los.results[1].visible, false);
            report.los = { inside: true, outside: false };
            const lighting = {
                ...restore.lighting,
                sources: [
                    ...restore.lighting.sources,
                    {
                        id: 'qa-builder06-light',
                        name: 'QA annex light',
                        x: 390,
                        y: 340,
                        tokenId: null,
                        enabled: true,
                        radius: 300,
                        color: '#ffffff',
                        intensity: 1,
                        falloff: 1,
                    },
                ],
            };
            await api(gm, scene + '/lighting', 'PUT', {
                expected: restore.lighting,
                value: lighting,
            });
            restore.lightingLatest = lighting;
            record();
            const field = await api(gm, scene + '/lighting');
            fs.writeFileSync(out + '/light-field.json', JSON.stringify(field));
            assert.equal(lit(field, 'qa-builder06-light', [300, 340]), true);
            assert.equal(lit(field, 'qa-builder06-light', [240, 340]), false);
            check(
                'GM/Player reload, server-filtered geometry, LOS and Lighting agree with the merged curved boundary.',
            );
            // Use the existing hero; never record fog exploration or retain QA token movement.
            const token = restore.tokens[0],
                tokenPath = '/tokens/' + token.id;
            await api(gm, tokenPath + '/move', 'POST', { x: 390, y: 340, intent: 'override' });
            restore.tokenMoved = true;
            record();
            const moved = await api(gm, tokenPath + '/move', 'POST', { x: 320, y: 340 });
            assert.ok(Math.abs(moved.token.x - 320) < 1);
            await api(gm, tokenPath + '/move', 'POST', { x: 240, y: 340 }, 422);
            check(
                'Token crosses the former straight wall into the annex; the curved exterior rejects movement.',
            );
            assert.deepEqual(report.errors, []);
            report.passed = true;
            report.finalHash = finalHash;
            report.persistedBuilding = true;
        } catch (error) {
            report.failure = error.message;
            if (gm) await gm.screenshot({ path: out + '/failure.png' }).catch(() => {});
            throw error;
        } finally {
            try {
                if (restore) {
                    if (restore.tokenMoved)
                        for (const t of restore.tokens)
                            await api(gm, '/tokens/' + t.id + '/move', 'POST', {
                                x: t.x,
                                y: t.y,
                                intent: 'override',
                            });
                    if (restore.lightingLatest)
                        await api(gm, scene + '/lighting', 'PUT', {
                            expected: restore.lightingLatest,
                            value: restore.lighting,
                        });
                    if (!report.passed && restore.original) {
                        const s = (await snapshot(gm)).structure;
                        assert.equal(s.hash, restore.latest, 'Scene changed outside QA');
                        await api(gm, scene + '/edit-history', 'POST', {
                            changes: [
                                {
                                    kind: 'structure',
                                    id: '10',
                                    expected: { hash: s.hash },
                                    value: restore.original,
                                },
                            ],
                        });
                        report.restored = true;
                    }
                    if (String((await api(gm, campaign)).activeSceneId) !== String(restore.active))
                        await api(gm, campaign + '/activate', 'POST', { sceneId: restore.active });
                    fs.unlinkSync(backup);
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
