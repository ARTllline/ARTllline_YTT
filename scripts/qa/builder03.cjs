/* eslint-disable @typescript-eslint/no-require-imports -- Reversible Chromium QA on the existing Scene 10. */
/* global require, process, console, window, document, Buffer */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');

const scene = '/scenes/10';
const campaign = '/campaigns/5';
const out = 'artifacts/builder03';
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

function decode(mask) {
    if (!mask.startsWith('~')) return Buffer.from(mask, 'base64');
    const source = Buffer.from(mask.slice(1), 'base64'),
        chunks = [];
    for (let i = 0; i < source.length; i += 3)
        chunks.push(Buffer.alloc(source.readUInt16LE(i), source[i + 2]));
    return Buffer.concat(chunks);
}
function lit(field, sourceId, [x, y]) {
    const source = field.sources.find((s) => s.id === sourceId);
    const bits = decode(source.mask);
    const index = Math.floor(y / field.cellSize) * field.width + Math.floor(x / field.cellSize);
    return !!(bits[index >> 3] & (1 << (index & 7)));
}
const graphics = (page) =>
    page.evaluate(() => {
        const rows = [];
        const walk = (n) => {
            if (n.context?.instructions) rows.push(n);
            for (const c of n.children ?? []) walk(c);
        };
        walk(window.tabletopApp.stage);
        return rows.length;
    });
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
        let current = await snapshot(gm);
        const originalRoomCount = current.structure.graph.rooms.length;
        restore = {
            active: (await api(gm, campaign)).activeSceneId,
            lighting: current.lighting,
            originalHash: current.structure.hash,
            latest: current.structure.hash,
        };
        record();
        if (String(restore.active) !== '10')
            await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            { reducedMotion: 'reduce', extraHTTPHeaders },
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
        const drag = async (a, b, preview) => {
            await gm.mouse.move(...(await point(gm, a)));
            await gm.mouse.down();
            await gm.mouse.move(...(await position(gm, b)), { steps: 8 });
            if (preview) await preview();
            await gm.mouse.up();
        };
        const altDrag = async (a, b, preview) => {
            await gm.keyboard.down('Alt');
            try {
                await drag(a, b, preview);
            } finally {
                await gm.keyboard.up('Alt');
            }
        };
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
            restore.original ??= data.structureEdit?.before;
            restore.latest = data.structure.hash;
            record();
            await gm.locator('.map-editor-status .save-saved').waitFor();
            current = await snapshot(gm);
            assert.equal(current.structure.hash, restore.latest);
            return current.structure;
        };
        const material = async (type) => {
            const name = 'Материал ' + type;
            await choose(name);
            const picker = gm.getByRole('region', { name });
            await picker.locator('button.build-material-tile[aria-label]').first().click();
        };
        const playerDelta = async (group) => {
            await player.waitForFunction(
                (group) =>
                    window.movementFrames.some((raw) => {
                        try {
                            const event = JSON.parse(JSON.parse(raw).data);
                            return (
                                event.payload?.structurePatch?.edges?.upsert?.some(
                                    (e) => e.curve?.group === group,
                                ) || event.payload?.structureRefresh
                            );
                        } catch {
                            return false;
                        }
                    }),
                group,
                { timeout: 12000 },
            );
            const graph = (await snapshot(player)).structure.graph;
            assert.ok(graph.edges.some((e) => e.curve?.group === group));
            assert.ok(graph.edges.every((e) => !('blocksVision' in e) && !('blocksLight' in e)));
        };
        await align(gm, 0.5, [450, 460]);
        const baselineGraphics = await graphics(gm);
        await choose('Круг');
        await material('стены');
        await material('пола');
        const tower = await save(() =>
            altDrag([180, 240], [280, 240], async () => {
                await label(gm, 'Rx 100.0');
                await capture('01-circle-preview-50');
            }),
        );
        const circle = tower.graph.edges.find((e) => e.curve?.kind === 'circle').curve;
        assert.equal(tower.graph.edges.filter((e) => e.curve?.group === circle.group).length, 4);
        assert.equal(tower.graph.rooms.length, originalRoomCount + 1);
        assert.ok(
            tower.graph.rooms.find((room) =>
                room.loop.every((id) =>
                    tower.graph.edges
                        .filter((e) => e.curve?.group === circle.group)
                        .some((e) => e.a === id),
                ),
            ).materialVersionId,
        );
        await playerDelta(circle.group);
        await choose('Овал');
        const hall = await save(() =>
            altDrag([180, 560], [310, 640], async () => {
                await label(gm, 'Rx 130.0');
                await capture('02-ellipse-preview-50');
            }),
        );
        const ellipse = hall.graph.edges.find((e) => e.curve?.kind === 'ellipse').curve;
        assert.equal(ellipse.rx, 130);
        assert.equal(ellipse.ry, 80);
        check(
            '50%: mouse creation and live dimensions of a circular tower and oval hall; floor materials and Player realtime.',
        );
        await choose('Правка');
        await click([180, 460]); // outside both rooms
        await click([180, 240]); // room center selects room
        await inspector.getByText('Круглая комната', { exact: true }).waitFor();
        const radius = inspector.getByRole('spinbutton', { name: 'Радиус X, wu', exact: true });
        await radius.fill('110');
        const resized = await save(() =>
            inspector.getByRole('button', { name: 'Применить форму', exact: true }).click(),
        );
        assert.equal(
            resized.graph.edges.find((e) => e.curve?.group === circle.group).curve.rx,
            110,
        );
        assert.equal(
            (await save(() => gm.keyboard.press('Control+z'), 'edit-history')).hash,
            hall.hash,
        );
        assert.equal(
            (await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history')).hash,
            resized.hash,
        );
        await capture('03-circle-inspector-50');
        await choose('Сегмент');
        const connected = await save(async () => {
            await click([290, 240]);
            await click([360, 240]);
        });
        const joint = connected.graph.vertices.find((v) => v.x === 290 && v.y === 240);
        assert.equal(
            connected.graph.edges.filter((e) => e.a === joint.id || e.b === joint.id).length,
            3,
        );
        check(
            '50%: Inspector radius, Undo/Redo, straight wall connection through a shared vertex.',
        );
        await align(gm, 1, [180, 510]);
        await choose('Правка');
        await click([180, 560]);
        await inspector.getByText('Овальная комната', { exact: true }).waitFor();
        const widened = await save(() =>
            altDrag([310, 560], [320, 560], () => label(gm, 'Rx 140.0')),
        );
        assert.equal(
            widened.graph.edges.find((e) => e.curve?.group === ellipse.group).curve.rx,
            140,
        );
        const moved = await save(() =>
            altDrag([180, 560], [190, 570], () => label(gm, 'Rx 140.0')),
        );
        assert.equal(moved.graph.edges.find((e) => e.curve?.group === ellipse.group).curve.cx, 190);
        await inspector.getByRole('spinbutton', { name: 'Поворот, °', exact: true }).fill('15');
        const rotated = await save(() =>
            inspector.getByRole('button', { name: 'Применить форму', exact: true }).click(),
        );
        assert.equal(
            rotated.graph.edges.find((e) => e.curve?.group === ellipse.group).curve.rotation,
            15,
        );
        await capture('04-ellipse-handles-100');
        await choose('Дверь');
        // Place on the upper-left quarter, away from graph seams.
        const angle = (225 * Math.PI) / 180,
            r = (15 * Math.PI) / 180;
        const doorPoint = [
            190 + 140 * Math.cos(angle) * Math.cos(r) - 80 * Math.sin(angle) * Math.sin(r),
            570 + 140 * Math.cos(angle) * Math.sin(r) + 80 * Math.sin(angle) * Math.cos(r),
        ];
        const withDoor = await save(() => click(doorPoint));
        const opening = withDoor.graph.openings.find(
            (o) => !rotated.graph.openings?.some((old) => old.id === o.id),
        );
        assert.ok(opening);
        await choose('Правка');
        await click([190, 570]);
        await inspector.getByRole('spinbutton', { name: 'Радиус X, wu', exact: true }).fill('145');
        const preserved = await save(() =>
            inspector.getByRole('button', { name: 'Применить форму', exact: true }).click(),
        );
        assert.deepEqual(
            preserved.graph.openings.find((o) => o.id === opening.id),
            opening,
        );
        check(
            '100%: radius and center handles, rotation Inspector, curved door and stable opening identity on reshape.',
        );
        const translated = await save(() =>
            altDrag([190, 620], [200, 620], () => label(gm, 'Δ X 10.0')),
        );
        assert.equal(
            translated.graph.edges.find((e) => e.curve?.group === ellipse.group).curve.cx,
            200,
        );
        assert.deepEqual(
            translated.graph.openings.find((o) => o.id === opening.id),
            opening,
        );
        await inspector.getByRole('spinbutton', { name: 'Толщина, wu', exact: true }).fill('18');
        const thickened = await save(() =>
            inspector.getByRole('button', { name: 'Применить к стенам', exact: true }).click(),
        );
        assert.ok(
            thickened.graph.edges
                .filter((e) => e.curve?.group === ellipse.group)
                .every((e) => e.thickness === 18),
        );
        await inspector.getByRole('spinbutton', { name: 'Радиус X, wu', exact: true }).fill('18');
        await inspector.getByRole('spinbutton', { name: 'Радиус Y, wu', exact: true }).fill('18');
        await inspector.getByRole('button', { name: 'Применить форму', exact: true }).click();
        await gm.locator('.map-editor-notice').getByText(/Проём/).waitFor();
        assert.equal((await snapshot(gm)).structure.hash, thickened.hash);
        check(
            '100%: BUILDER-02 room drag and group thickness preserve openings; unsafe radius change is rejected without mutation.',
        );

        await align(gm, 1, [1040, 810]);
        await choose('Дуга');
        await altDrag([1040, 870], [1140, 870], () => label(gm, 'R 100.0'));
        const arcBuilt = await save(() => click([940, 870]));
        const arc = arcBuilt.graph.edges.find(
            (e) => e.curve?.group !== circle.group && e.curve?.group !== ellipse.group && e.curve,
        ).curve;
        assert.equal(arc.sweep, 180);
        await choose('Правка');
        await click([1040, 970]);
        await inspector.getByText('Дуговая стена', { exact: true }).waitFor();
        await inspector
            .getByRole('spinbutton', { name: 'Размах дуги, °', exact: true })
            .fill('150');
        const arcEdited = await save(() =>
            inspector.getByRole('button', { name: 'Применить форму', exact: true }).click(),
        );
        assert.equal(
            arcEdited.graph.edges.find((e) => e.curve?.group === arc.group).curve.sweep,
            150,
        );
        const radiusArc = await save(() =>
            altDrag([1160, 870], [1170, 870], () => label(gm, 'Rx 110.0')),
        );
        assert.equal(radiusArc.graph.edges.find((e) => e.curve?.group === arc.group).curve.rx, 110);
        assert.equal(
            (await save(() => gm.keyboard.press('Control+z'), 'edit-history')).hash,
            arcEdited.hash,
        );
        assert.equal(
            (await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history')).hash,
            radiusArc.hash,
        );
        await choose('Сегмент');
        const arcConnected = await save(async () => {
            await click([1150, 870]);
            await click([1250, 870]);
        });
        const arcJoint = arcConnected.graph.vertices.find((v) => v.x === 1150 && v.y === 870);
        assert.equal(
            arcConnected.graph.edges.filter((e) => e.a === arcJoint.id || e.b === arcJoint.id)
                .length,
            2,
        );
        await choose('Правка');
        await click([1040, 980]);
        await capture('05-arc-inspector-100');
        await align(gm, 0.5, [1040, 810]);
        await gm.keyboard.down('Shift');
        const arc50 = await save(() =>
            altDrag([944.737, 925], [962.218, 947.782], () => label(gm, '135.0°')),
        );
        await gm.keyboard.up('Shift');
        assert.ok(
            Math.abs(
                arc50.graph.edges.find((e) => e.curve?.group === arc.group).curve.sweep - 135,
            ) < 0.01,
        );
        await capture('05b-arc-handle-50');
        check('50/100%: arc radius and angle handles, straight-wall junction and Undo/Redo.');

        await playerDelta(arc.group);
        const finalHash = current.structure.hash;
        await gm.reload();
        await tabletop(gm).waitFor();
        assert.equal((await snapshot(gm)).structure.hash, finalHash);
        await editor(gm);
        await align(gm, 0.5, [450, 500]);
        await capture('06-all-curves-reload-50');
        report.graphics = { before: baselineGraphics, after: await graphics(gm) };
        assert.equal(report.graphics.after, report.graphics.before);
        const los = await api(gm, scene + '/los', 'POST', {
            observer: { point: { x: 180, y: 240 } },
            targets: [{ point: { x: 230, y: 240 } }, { point: { x: 320, y: 240 } }],
        });
        assert.equal(los.results[0].visible, true);
        assert.equal(los.results[1].visible, false);

        const settings = (await snapshot(gm)).lighting;
        const lighting = {
            ...settings,
            sources: [
                ...settings.sources,
                {
                    id: 'qa-builder03-light',
                    name: 'QA curve light',
                    x: 180,
                    y: 240,
                    tokenId: null,
                    enabled: true,
                    radius: 250,
                    color: '#ffffff',
                    intensity: 1,
                    falloff: 1,
                },
            ],
        };
        const lightSaved = await api(gm, scene + '/lighting', 'PUT', {
            expected: settings,
            value: lighting,
        });
        restore.lightingLatest = lighting;
        record();
        const field = await api(gm, scene + '/lighting');
        assert.equal(lit(field, 'qa-builder03-light', [180, 240]), true);
        assert.equal(lit(field, 'qa-builder03-light', [320, 240]), false);
        assert.equal(
            lit(field, 'qa-builder03-light', [250, 310]),
            true,
            'Curved corner must not follow a four-chord diamond',
        );
        await gm.waitForFunction(
            (revision) =>
                window.movementFrames.some((raw) => {
                    try {
                        const e = JSON.parse(JSON.parse(raw).data);
                        return (
                            e.type === 'lighting.frame' &&
                            e.revision >= revision &&
                            e.render?.sources.some((s) => s.id === 'qa-builder03-light')
                        );
                    } catch {
                        return false;
                    }
                }),
            lightSaved.revision,
            { timeout: 12000 },
        );
        const realtimeLight = await gm.evaluate(
            () =>
                window.movementFrames
                    .map((raw) => {
                        try {
                            return JSON.parse(JSON.parse(raw).data);
                        } catch {
                            return null;
                        }
                    })
                    .filter(
                        (e) =>
                            e?.type === 'lighting.frame' &&
                            e.render?.sources.some((s) => s.id === 'qa-builder03-light'),
                    )
                    .at(-1).render,
        );
        assert.equal(
            lit(realtimeLight, 'qa-builder03-light', [250, 310]),
            true,
            'Worker must use curved geometry too',
        );

        report.los = { inside: los.results[0].visible, outside: los.results[1].visible };
        report.light = { inside: true, diagonalInside: true, outside: false, realtime: true };
        await button(gm, 'Закрыть редактор карты').click();
        await align(gm, 1, [180, 240]);
        await gm.waitForTimeout(700);
        await capture('07-lit-tower-wall-100');

        check(
            'Reload, bounded Pixi Graphics, LOS and actual Lighting mask agree with the tower perimeter.',
        );
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } catch (error) {
        report.failure = error.message;
        console.error('QA failure:', error.message);
        if (gm) await capture('failure').catch(() => {});
        throw error;
    } finally {
        try {
            if (restore) {
                if (restore.lightingLatest) {
                    await api(gm, scene + '/lighting', 'PUT', {
                        expected: restore.lightingLatest,
                        value: restore.lighting,
                    });
                }
                const current = (await snapshot(gm)).structure;
                if (current.hash !== restore.originalHash) {
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
                assert.equal((await snapshot(gm)).structure.hash, restore.originalHash);
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
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
