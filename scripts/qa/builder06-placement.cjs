/* eslint-disable @typescript-eslint/no-require-imports -- Reversible containment/contact regression on the existing Scene 10. */
/* global require, module, process, console, structuredClone */
const fs = require('node:fs'),
    assert = require('node:assert/strict');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');
const { align, editor, position } = require('./builder06.cjs');
const scene = '/scenes/10',
    campaign = '/campaigns/5',
    out = 'artifacts/builder06-placement',
    backup = out + '/restore.private.json';
const report = { checks: [], errors: [], passed: false, restored: false };
const button = (p, name) => p.getByRole('button', { name, exact: true });
function rect(prefix, x, y, w, h, floor, wall) {
    const vertices = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
    ].map(([x, y], i) => ({ id: prefix + 'v' + i, x, y }));
    const edges = vertices.map((a, i) => ({
        id: prefix + 'e' + i,
        a: a.id,
        b: vertices[(i + 1) % 4].id,
        thickness: 14,
        materialVersionId: wall,
        blocksMovement: true,
        blocksVision: true,
        blocksLight: true,
    }));
    return {
        vertices,
        edges,
        rooms: [{ id: prefix + 'room', loop: vertices.map((v) => v.id), materialVersionId: floor }],
    };
}
module.exports = { rect };
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, restore;
    const snapshot = () => api(gm, scene + '/snapshot'),
        record = () => fs.writeFileSync(backup, JSON.stringify(restore));
    const check = (s) => {
        report.checks.push(s);
        console.log(s);
    };
    const accept = (d) => {
        restore.original ??= d.structureEdit.before;
        restore.latest = d.structure.hash;
        record();
        return d.structure.graph;
    };
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        const options = {
            viewport: { width: 1700, height: 1130 },
            reducedMotion: 'reduce',
            extraHTTPHeaders: { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' },
        };
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
            options,
        );
        await gm.goto(base + campaign + scene + '?mode=prepare');
        if (process.argv.includes('--restore')) {
            restore = JSON.parse(fs.readFileSync(backup, 'utf8'));
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore interrupted placement QA first');
        const initial = await snapshot();
        restore = {
            active: (await api(gm, campaign)).activeSceneId,
            latest: initial.structure.hash,
            hash: initial.structure.hash,
        };
        record();
        const source = initial.structure.graph.assemblies?.flatMap((a) => a.sources) ?? [];
        const floor1 =
            source[0]?.graph.rooms[0].materialVersionId ??
            initial.structure.graph.rooms.find((r) => r.materialVersionId)?.materialVersionId;
        const floor2 =
            source.find(
                (s) =>
                    s.graph.rooms[0].materialVersionId &&
                    s.graph.rooms[0].materialVersionId !== floor1,
            )?.graph.rooms[0].materialVersionId ?? floor1;
        const wall = initial.structure.graph.edges[0]?.materialVersionId ?? null;
        assert.ok(floor1 && floor2);
        const noOpenings = structuredClone(initial.structure.graph);
        noOpenings.openings = [];
        for (const a of noOpenings.assemblies ?? [])
            for (const s of a.sources) s.graph.openings = [];
        accept(
            await api(gm, scene + '/structure', 'POST', {
                expected: restore.latest,
                value: noOpenings,
            }),
        );
        const outer = rect('qplace-outer-', 400, 280, 400, 400, floor1, wall),
            inner = rect('qplace-inner-', 150, 350, 150, 150, floor2, wall);
        const fixture = {
            vertices: [
                ...outer.vertices,
                ...inner.vertices,
                { id: 'qplace-free-a', x: 1100, y: 280 },
                { id: 'qplace-free-b', x: 1100, y: 680 },
            ],
            edges: [
                ...outer.edges,
                ...inner.edges,
                {
                    id: 'qplace-free',
                    a: 'qplace-free-a',
                    b: 'qplace-free-b',
                    thickness: 14,
                    materialVersionId: wall,
                    blocksMovement: true,
                    blocksVision: true,
                    blocksLight: true,
                },
            ],
            rooms: [...outer.rooms, ...inner.rooms],
        };
        accept(
            await api(gm, scene + '/structure', 'POST', {
                expected: restore.latest,
                value: fixture,
            }),
        );
        if (String(restore.active) !== '10')
            await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            options,
        );
        await player.goto(base + campaign + '/play');
        await tabletop(player).waitFor();
        await subscribed(player);
        for (const p of [gm, player]) p.on('pageerror', (e) => report.errors.push(e.message));
        await gm.reload();
        await editor(gm);
        await button(gm, 'Правка').click();
        await align(gm, 0.5, [700, 500]);
        const save = async (action, endpoint = 'structure') => {
            const pending = gm.waitForResponse(
                (r) =>
                    r.url().endsWith('/api' + scene + '/' + endpoint) &&
                    r.request().method() === 'POST',
                { timeout: 15000 },
            );
            await action();
            const r = await pending,
                d = await r.json();
            assert.equal(r.status(), 200, d.message);
            const graph = accept(d);
            await gm.locator('.map-editor-status .save-saved').waitFor();
            assert.equal((await snapshot()).structure.hash, restore.latest, 'MySQL hash');
            return graph;
        };
        const click = async (p) => gm.mouse.click(...(await position(gm, p)));
        const drag = async (a, b) => {
            await gm.keyboard.down('Alt');
            await gm.mouse.move(...(await position(gm, a)));
            await gm.mouse.down();
            await gm.mouse.move(...(await position(gm, b)), { steps: 10 });
            await gm.mouse.up();
            await gm.keyboard.up('Alt');
        };
        await click([225, 425]);
        let graph = await save(() => drag([225, 425], [575, 435]));
        assert.equal(
            await gm.getByRole('group', { name: 'Пересечение помещений', exact: true }).count(),
            0,
        );
        assert.equal(graph.rooms.length, 2);
        assert.equal(graph.assemblies[0].sources[1].mode, 'partition');
        assert.deepEqual(graph.assemblies[0].sources[0].graph.vertices, outer.vertices);
        assert.equal(graph.assemblies[0].sources[1].graph.rooms[0].materialVersionId, floor2);
        await gm
            .getByText('Загрузка изображений сцены…', { exact: true })
            .waitFor({ state: 'hidden', timeout: 20000 });
        await gm.screenshot({ path: out + '/01-nested-room.png' });
        await save(() => gm.keyboard.press('Control+z'), 'edit-history');
        graph = await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
        check(
            'Mouse move inside a floored room: no dialog, inner walls and floor persist, Undo/Redo are atomic.',
        );
        const los = await api(gm, scene + '/los', 'POST', {
            observer: { point: { x: 450, y: 400 } },
            targets: [{ point: { x: 575, y: 435 } }],
        });
        assert.equal(los.results[0].visible, false);
        await click([575, 435]);
        graph = await save(() => drag([575, 435], [475, 425]));
        let vertices = Object.fromEntries(graph.vertices.map((v) => [v.id, v]));
        assert.equal(
            graph.edges.filter(
                (e) =>
                    vertices[e.a].x === 400 &&
                    vertices[e.b].x === 400 &&
                    Math.min(vertices[e.a].y, vertices[e.b].y) === 350 &&
                    Math.max(vertices[e.a].y, vertices[e.b].y) === 500,
            ).length,
            1,
        );
        assert.deepEqual(graph.assemblies[0].sources[0].graph.vertices, outer.vertices);
        await gm.screenshot({ path: out + '/02-shared-room-wall.png' });
        check(
            'Mouse move wall-to-wall with another room: one shared wall, parent shape stays fixed.',
        );
        await click([475, 425]);
        graph = await save(() => drag([475, 425], [1175, 450]));
        vertices = Object.fromEntries(graph.vertices.map((v) => [v.id, v]));
        assert.equal(
            graph.edges.filter(
                (e) =>
                    vertices[e.a].x === 1100 &&
                    vertices[e.b].x === 1100 &&
                    Math.min(vertices[e.a].y, vertices[e.b].y) === 375 &&
                    Math.max(vertices[e.a].y, vertices[e.b].y) === 525,
            ).length,
            1,
        );
        await gm.screenshot({ path: out + '/03-shared-standalone-wall.png' });
        await click([1175, 450]);
        graph = await save(() => drag([1175, 450], [575, 435]));
        vertices = Object.fromEntries(graph.vertices.map((v) => [v.id, v]));
        assert.ok(
            graph.edges
                .filter((e) => !e.id.startsWith(graph.assemblies[0].id + '-'))
                .every((e) => vertices[e.a].x === 1100 && vertices[e.b].x === 1100),
        );
        check(
            'Mouse move onto a standalone wall and back: shared segment is unique and the supporting wall stays fixed.',
        );
        await button(gm, 'Круг').click();
        graph = await save(() => drag([200, 600], [260, 600]));
        const circle = graph.edges.find((e) => e.curve)?.curve;
        assert.ok(circle);
        await button(gm, 'Правка').click();
        await click([260, 600]);
        graph = await save(() => drag([200, 600], [700, 600]));
        const roundSource = graph.assemblies
            .flatMap((a) => a.sources)
            .find((s) => s.graph.edges.some((e) => e.curve?.group === circle.group));
        assert.equal(roundSource.mode, 'partition');
        assert.equal(roundSource.graph.edges[0].curve.cx, 700);
        assert.equal(graph.rooms.length, 3);
        check(
            'Circle center-handle placement inside the floored room preserves the complete parametric circle and inherits its parent floor.',
        );
        await gm.reload();
        await tabletop(gm).waitFor();
        assert.equal((await snapshot()).structure.hash, restore.latest);
        await player.reload();
        await tabletop(player).waitFor();
        const publicGraph = (await api(player, scene + '/snapshot')).structure.graph;
        assert.equal(publicGraph.rooms.length, 3);
        assert.ok(!publicGraph.assemblies);
        assert.deepEqual(report.errors, []);
        check('GM/Player reload and server LOS agree with nested walls; no browser errors.');
        report.passed = true;
    } catch (e) {
        report.failure = e.message;
        if (gm) await gm.screenshot({ path: out + '/failure.png' }).catch(() => {});
        throw e;
    } finally {
        try {
            if (restore) {
                const current = (await snapshot()).structure;
                if (restore.original && current.hash !== restore.hash) {
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
                assert.equal((await snapshot()).structure.hash, restore.hash);
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
