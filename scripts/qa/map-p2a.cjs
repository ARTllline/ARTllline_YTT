/* eslint-disable @typescript-eslint/no-require-imports -- QA on the existing local Scene 10. */
/* global require, process, console, window, requestAnimationFrame, structuredClone */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, base, login, subscribed, tabletop } = require('./map07a.cjs');
const { align, editor, position } = require('./builder06.cjs');
const manifest = require('../../resources/architecture/fantasy-classic/manifest.json');
const out = 'artifacts/map-p2a';
const scene = '/scenes/10';
const campaign = '/campaigns/5';
const options = {
    viewport: { width: 1650, height: 1080 },
    extraHTTPHeaders: { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' },
};
const snapshot = (page) => api(page, scene + '/snapshot');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const selectMaterials = (graph, ids) => {
    const next = structuredClone(graph);
    const paint = (g, wall, floor) => {
        for (const edge of g.edges) edge.materialVersionId = ids[wall];
        for (const room of g.rooms) room.materialVersionId = ids[floor];
    };
    const index = { door: 0, window: 0 };
    const openings = new Map(
        next.openings.map((o) => [
            o.id,
            ids[
                o.type === 'door'
                    ? [
                          'door-iron-oak',
                          'door-studded-walnut',
                          'door-portcullis',
                          'door-carved-oak',
                      ][index.door++ % 4]
                    : ['window-leaded-oak', 'window-iron-slit', 'window-brass'][index.window++ % 3]
            ],
        ]),
    );
    for (const o of next.openings) o.materialVersionId = openings.get(o.id);
    for (const edge of next.edges) {
        edge.materialVersionId = ids[edge.curve ? 'wall-ruins' : 'wall-fieldstone'];
    }
    for (const room of next.rooms) room.materialVersionId = ids['floor-moss'];
    for (const assembly of next.assemblies) {
        const finishes = [
            ['wall-ashlar', 'floor-oak'],
            ['wall-lime-oak', 'floor-herringbone'],
            ['wall-timber', 'floor-oak'],
            ['wall-brick', 'floor-terracotta'],
            ['wall-fieldstone', 'floor-slate'],
            ['wall-ashlar', 'floor-limestone'],
        ];
        for (const [i, source] of assembly.sources.entries()) {
            paint(source.graph, ...finishes[i % finishes.length]);
            for (const opening of source.graph.openings ?? [])
                opening.materialVersionId = openings.get(opening.id);
        }
    }
    return next;
};

async function frameIntervals(page) {
    return page.evaluate(async () => {
        const values = [];
        await new Promise((resolve) => {
            let first, previous;
            const step = (now) => {
                first ??= now;
                if (previous !== undefined) values.push(now - previous);
                previous = now;
                if (now - first < 2200) requestAnimationFrame(step);
                else resolve();
            };
            requestAnimationFrame(step);
        });
        values.sort((a, b) => a - b);
        return {
            samples: values.length,
            median: values[Math.floor(values.length / 2)],
            p95: values[Math.floor(values.length * 0.95)],
        };
    });
}

async function capture(page, name, zoom, center = [674, 544]) {
    await align(page, zoom, center);
    await page.waitForTimeout(750);
    await page.locator('.scene-loading-indicator').waitFor({ state: 'hidden' });
    await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.media-state').count(), 0);
    const actual = await page.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
    assert.ok(Math.abs(actual - zoom) < 0.01, `Unexpected zoom ${actual}`);
    await tabletop(page).screenshot({ path: `${out}/${name}-${zoom * 100}.png` });
}

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const report = { checks: [], errors: [], frameIntervals: {} };
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, player, initial, active, visualHash, recovery;
    const recoveryPath = out + '/qa-recovery.private.json';
    const record = () => fs.writeFileSync(recoveryPath, JSON.stringify(recovery));
    const restoreJunction = async () => {
        if (!recovery.junction) return;
        const { expected, value } = recovery.junction;
        const result = await api(gm, scene + '/edit-history', 'POST', {
            changes: [{ kind: 'structure', id: '10', expected, value }],
        });
        assert.equal(result.structure.hash, value.hash);
        delete recovery.junction;
        record();
    };
    try {
        const accounts = JSON.parse(
            fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json'),
        );
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
            options,
        );
        await gm.goto(base + campaign + scene + '?mode=prepare');
        initial = await snapshot(gm);
        visualHash = initial.structure.hash;
        active = (await api(gm, campaign)).activeSceneId;
        assert.ok(
            !fs.existsSync(recoveryPath),
            'Restore previous QA state from the private recovery file first.',
        );
        const { materials } = await api(gm, '/library/materials?search=Fantasy%20Classic');
        const { assets } = await api(
            gm,
            '/library/assets?category=architecture&search=Fantasy%20Classic',
        );
        const ids = Object.fromEntries(
            manifest.materials.map((item) => {
                const material = materials.find(
                    (m) => m.builtin && m.name === manifest.name + ' · ' + item.name,
                );
                assert.equal(material?.type, item.type);
                assert.equal(material?.layout ?? null, item.layout ?? null);
                return [item.key, material.versionId];
            }),
        );
        assert.equal(assets.filter((asset) => asset.builtin).length, 19);
        for (const asset of assets.filter((a) => a.builtin)) {
            assert.equal((await gm.request.get(base + asset.thumbnailUrl)).status(), 200);
        }
        report.checks.push(
            '19 materials and Global Assets thumbnails discoverable by pack and category',
        );
        recovery = { active, lighting: initial.lighting, before: initial.structure.hash };
        record();
        if (process.argv.includes('--apply')) {
            const value = selectMaterials(initial.structure.graph, ids);
            const result = await api(gm, scene + '/structure', 'POST', {
                expected: initial.structure.hash,
                value,
            });
            visualHash = result.structure.hash;
            recovery.originalStructure = result.structureEdit.before;
            record();
        }
        recovery.visualHash = visualHash;
        record();
        await gm.reload();
        gm.on('pageerror', (e) => report.errors.push('GM: ' + e.message));
        await editor(gm);
        let current = await snapshot(gm);
        assert.equal(current.structure.hash, visualHash);
        assert.ok(current.structure.graph.edges.some((edge) => edge.curve?.kind === 'circle'));
        assert.ok(current.structure.graph.edges.some((edge) => edge.curve?.kind === 'ellipse'));
        assert.ok(current.structure.graph.floors.length);
        assert.ok(
            current.structure.graph.openings.every((o) =>
                Object.values(ids).includes(o.materialVersionId),
            ),
        );
        report.checks.push(
            'Scene 10 rectangular and curved walls, union floors and styled openings persisted after reload',
        );
        for (const zoom of [0.5, 1]) {
            await capture(gm, 'after-editor-night', zoom);
            report.frameIntervals[zoom] = await frameIntervals(gm);
        }
        await button(gm, 'Материалы').click();
        const library = gm.getByRole('complementary', { name: 'Материалы', exact: true });
        await library.getByRole('combobox', { name: 'Тип материала' }).selectOption('door');
        await library.getByRole('textbox', { name: 'Поиск материалов' }).fill('Fantasy Classic');
        await library.locator('.material-card').nth(3).waitFor();
        await library.locator('.material-preview-status').first().waitFor({ state: 'hidden' });
        assert.equal(await library.locator('.material-card').count(), 4);
        await library.screenshot({ path: out + '/door-library.png' });
        await button(gm, 'Закрыть материалы').click();
        if (!(await button(gm, 'Правка').isVisible())) await button(gm, 'Build').click();
        report.checks.push(
            'Material Library renders four distinct door previews and short display names',
        );
        const commit = async (action, endpoint) => {
            const pending = gm.waitForResponse(
                (r) =>
                    r.url().endsWith('/api' + scene + '/' + endpoint) &&
                    r.request().method() === 'POST',
            );
            await action();
            const response = await pending;
            assert.equal(response.status(), 200, await response.text());
            await gm.locator('.map-editor-status .save-saved').waitFor();
            return snapshot(gm);
        };
        // Edit one straight door through its existing inspector and verify the actual history path.
        const target = current.structure.graph.openings.find(
            (o) =>
                o.type === 'door' &&
                !o.locked &&
                current.structure.graph.edges.find((e) => e.id === o.edgeId && !e.curve),
        );
        assert.ok(target);
        const wall = current.structure.graph.edges.find((e) => e.id === target.edgeId);
        const verts = new Map(current.structure.graph.vertices.map((v) => [v.id, v]));
        const a = verts.get(wall.a),
            b = verts.get(wall.b);
        const center = [a.x + (b.x - a.x) * target.center, a.y + (b.y - a.y) * target.center];
        await button(gm, 'Правка').click();
        await align(gm, 1, center);
        await gm.mouse.click(...(await position(gm, center)));
        await button(gm, 'Стиль двери').click();
        const chosen = materials.find(
            (m) => m.builtin && m.type === 'door' && m.versionId !== target.materialVersionId,
        );
        current = await commit(
            () =>
                gm
                    .getByRole('region', { name: 'Стиль двери' })
                    .getByRole('button', { name: chosen.name, exact: true })
                    .click(),
            'structure',
        );
        const editedHash = current.structure.hash;
        assert.equal(
            current.structure.graph.openings.find((o) => o.id === target.id).materialVersionId,
            chosen.versionId,
        );
        assert.equal(
            (await commit(() => gm.keyboard.press('Control+z'), 'edit-history')).structure.hash,
            visualHash,
        );
        assert.equal(
            (await commit(() => gm.keyboard.press('Control+Shift+z'), 'edit-history')).structure
                .hash,
            editedHash,
        );
        assert.equal(
            (await commit(() => gm.keyboard.press('Control+z'), 'edit-history')).structure.hash,
            visualHash,
        );
        report.checks.push(
            'Build door picker applies an immutable style, Undo/Redo restores exact hashes',
        );

        await api(gm, campaign + '/activate', 'POST', { sceneId: 10 });
        await gm.goto(base + campaign + scene + '?mode=session');
        player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            options,
        );
        player.on('pageerror', (e) => report.errors.push('Player: ' + e.message));
        await player.goto(base + campaign + '/play');
        await Promise.all(
            [gm, player].map(async (p) => {
                await tabletop(p).waitFor();
                await subscribed(p);
            }),
        );
        const visible = await snapshot(player);
        assert.equal(String(visible.id), '10');
        assert.ok(!visible.structure.graph.assemblies);
        assert.ok(visible.structure.graph.openings.every((o) => !('locked' in o)));
        for (const m of visible.structure.materials) {
            assert.equal((await player.request.get(base + m.asset.url)).status(), 200);
        }
        const door = current.structure.graph.openings.find(
            (o) =>
                o.type === 'door' &&
                !o.locked &&
                current.structure.graph.edges.find((e) => e.id === o.edgeId && e.curve),
        );
        assert.ok(door, 'A styled curved door is required for the open-state capture');
        await api(gm, scene + '/structure', 'POST', {
            expected: visualHash,
            door: { id: door.id, open: true },
        });
        recovery.door = door.id;
        record();
        for (const mode of ['night', 'day']) {
            const lighting = (await snapshot(gm)).lighting;
            if (lighting.mode !== mode)
                await api(gm, scene + '/lighting', 'PUT', {
                    expected: lighting,
                    value: { ...lighting, mode, brightness: 1, color: '#fff4df' },
                });
            for (const [role, p] of [
                ['gm', gm],
                ['player', player],
            ]) {
                for (const zoom of [0.5, 1]) await capture(p, `after-${role}-${mode}`, zoom);
            }
        }
        await player.reload();
        await tabletop(player).waitFor();
        assert.equal(
            (await snapshot(player)).structure.graph.openings.find((o) => o.id === door.id).open,
            true,
        );
        report.checks.push(
            'GM and Player Session, day/night at 50% and 100%, curved open state survives player reload',
        );
        const preJunction = (await snapshot(gm)).structure;
        const graph = preJunction.graph;
        const points = [
            [1140, 805],
            [1280, 805],
            [1210, 735],
            [1210, 875],
        ];
        for (const [i, [x, y]] of points.entries()) graph.vertices.push({ id: `qp2av${i}`, x, y });
        for (const [i, [a, b]] of [
            [0, 1],
            [2, 3],
        ].entries())
            graph.edges.push({
                id: `qp2ae${i}`,
                a: `qp2av${a}`,
                b: `qp2av${b}`,
                thickness: 24,
                materialVersionId: ids['wall-ashlar'],
                blocksMovement: true,
                blocksVision: true,
                blocksLight: true,
            });
        const junction = await api(gm, scene + '/structure', 'POST', {
            expected: preJunction.hash,
            value: graph,
        });
        recovery.junction = {
            expected: { hash: junction.structure.hash },
            value: junction.structureEdit.before,
        };
        record();
        const cross = junction.structure.graph.vertices.find((v) => v.x === 1210 && v.y === 805);
        assert.ok(cross, 'A degree-four vertex must exist at the cross');
        assert.equal(
            junction.structure.graph.edges.filter((e) => e.a === cross.id || e.b === cross.id)
                .length,
            4,
        );
        await gm.reload();
        await tabletop(gm).waitFor();
        await capture(gm, 'qa-x-junction-day', 1, [1210, 805]);
        await restoreJunction();
        report.checks.push(
            'X-junction compiled as a shared vertex, captured at 100%, and removed by exact history restore',
        );
        assert.deepEqual(report.errors, []);
    } finally {
        try {
            if (gm && recovery) {
                await player?.context().close();
                await restoreJunction();
                const now = await snapshot(gm);
                if (
                    recovery.door &&
                    now.structure.graph.openings.find((o) => o.id === recovery.door)?.open
                ) {
                    await api(gm, scene + '/structure', 'POST', {
                        expected: now.structure.hash,
                        door: { id: recovery.door, open: false },
                    });
                }
                if (JSON.stringify(now.lighting) !== JSON.stringify(initial.lighting))
                    await api(gm, scene + '/lighting', 'PUT', {
                        expected: now.lighting,
                        value: initial.lighting,
                    });
                if (String(active) !== '10')
                    await api(gm, campaign + '/activate', 'POST', { sceneId: active });
                const final = await snapshot(gm);
                assert.equal(final.structure.hash, visualHash);
                assert.deepEqual(final.lighting, initial.lighting);
                assert.equal(String((await api(gm, campaign)).activeSceneId), String(active));
                report.restored = true;
                report.finalHash = final.structure.hash;
                if (recovery.originalStructure)
                    fs.copyFileSync(recoveryPath, out + '/before-style.private.json');
                fs.unlinkSync(recoveryPath);
            }
        } finally {
            fs.writeFileSync(out + '/chromium.json', JSON.stringify(report, null, 2));
            await browser.close();
        }
    }
    console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
