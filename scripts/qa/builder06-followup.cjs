/* eslint-disable @typescript-eslint/no-require-imports -- Final reversible Chromium checks on the retained building. */
/* global require, process, console, window */
const fs = require('node:fs'),
    assert = require('node:assert/strict');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');
const { align, editor, position, lit } = require('./builder06.cjs');
const scene = '/scenes/10',
    campaign = '/campaigns/5',
    out = 'artifacts/builder06';
const button = (p, name) => p.getByRole('button', { name, exact: true });
const report = { checks: [], errors: [], passed: false };
const check = (s) => {
    report.checks.push(s);
    console.log(s);
};
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, restore, latest;
    const backup = out + '/followup-restore.private.json';
    const record = () => fs.writeFileSync(backup, JSON.stringify(restore));
    const snapshot = () => api(gm, scene + '/snapshot');
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
            latest = restore.latest;
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore interrupted followup first');
        const initial = await snapshot();
        restore = {
            active: (await api(gm, campaign)).activeSceneId,
            lighting: initial.lighting,
            latest: initial.structure.hash,
        };
        latest = restore.latest;
        record();
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
        const save = async (action, endpoint = 'structure') => {
            const pending = gm.waitForResponse(
                (r) =>
                    r.url().endsWith('/api' + scene + '/' + endpoint) &&
                    r.request().method() === 'POST',
            );
            await action();
            const r = await pending,
                d = await r.json();
            assert.equal(r.status(), 200, d.message);
            restore.original ??= d.structureEdit.before;
            latest = d.structure.hash;
            restore.latest = latest;
            record();
            await gm.locator('.map-editor-status .save-saved').waitFor();
            assert.equal((await snapshot()).structure.hash, latest);
            return d;
        };
        await editor(gm);
        await button(gm, 'Правка').click();
        await align(gm, 0.5, [700, 540]);
        await gm.mouse.click(...(await position(gm, [1000, 900])));
        const inspector = gm.getByRole('complementary', { name: 'Inspector Build' });
        const width = inspector.getByRole('spinbutton', {
            name: 'Ширина исходного помещения, wu',
            exact: true,
        });
        await width.fill('210');
        await save(() => button(inspector, 'Применить исходную форму').click());
        await save(() => gm.keyboard.press('Control+z'), 'edit-history');
        await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
        await save(() => gm.keyboard.press('Control+z'), 'edit-history');
        check(
            'Straight annex source dimensions work after assembly; Undo/Redo restores source and graph together.',
        );
        await button(gm, 'Окно').click();
        await gm.getByRole('spinbutton', { name: 'Ширина проёма, wu', exact: true }).fill('32');
        const before = (await snapshot()).structure.graph;
        const seamPoint = await position(gm, [270, 340]);
        const opened = await save(() => gm.mouse.click(...seamPoint));
        const graph = opened.structure.graph;
        assert.equal(graph.openings.length, before.openings.length + 1);
        assert.ok(before.openings.every((o) => graph.openings.some((n) => n.id === o.id)));
        const circleSource = graph.assemblies[0].sources.find((s) =>
            s.graph.edges.some((e) => e.curve?.cx === 360 && e.curve?.cy === 340),
        );
        assert.equal(circleSource.graph.edges.length, 4);
        await save(() => gm.keyboard.press('Control+z'), 'edit-history');
        await save(() => gm.keyboard.press('Control+Shift+z'), 'edit-history');
        await gm.reload();
        await editor(gm);
        await button(gm, 'Правка').click();
        await align(gm, 1, [320, 340]);
        await gm.screenshot({ path: out + '/06-quarter-seam-window-100.png' });
        check(
            'Window crosses a quarter seam in one transaction, preserves the existing door and survives Undo/Redo and reload.',
        );
        await player.waitForFunction(
            (revision) =>
                window.movementFrames.some((raw) => {
                    try {
                        const e = JSON.parse(JSON.parse(raw).data);
                        return (
                            e.revision >= revision &&
                            (e.payload?.structureRefresh || e.payload?.structurePatch)
                        );
                    } catch {
                        return false;
                    }
                }),
            opened.revision,
            { timeout: 15000 },
        );
        const playerState = await api(player, scene + '/snapshot');
        assert.equal(playerState.structure.graph.openings.length, graph.openings.length);
        assert.ok(!playerState.structure.graph.assemblies);
        check('Player receives the geometry update over Reverb; source recipes remain GM-only.');
        const lighting = {
            ...restore.lighting,
            sources: [
                ...restore.lighting.sources,
                {
                    id: 'qa-builder06-realtime',
                    name: 'QA annex realtime',
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
        const saved = await api(gm, scene + '/lighting', 'PUT', {
            expected: restore.lighting,
            value: lighting,
        });
        restore.lightingLatest = lighting;
        record();
        const field = await api(gm, scene + '/lighting');
        assert.equal(lit(field, 'qa-builder06-realtime', [300, 340]), true);
        assert.equal(lit(field, 'qa-builder06-realtime', [240, 340]), true, 'The transparent seam window admits light');
        assert.equal(lit(field, 'qa-builder06-realtime', [240, 260]), false);
        await gm.waitForFunction(
            (revision) =>
                window.movementFrames.some((raw) => {
                    try {
                        const e = JSON.parse(JSON.parse(raw).data);
                        return (
                            e.type === 'lighting.frame' &&
                            e.revision >= revision &&
                            e.render?.sources.some((s) => s.id === 'qa-builder06-realtime')
                        );
                    } catch {
                        return false;
                    }
                }),
            saved.revision,
            { timeout: 15000 },
        );
        const realtime = await gm.evaluate(
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
                            e.render?.sources.some((s) => s.id === 'qa-builder06-realtime'),
                    )
                    .at(-1).render,
        );
        assert.equal(lit(realtime, 'qa-builder06-realtime', [300, 340]), true);
        assert.equal(lit(realtime, 'qa-builder06-realtime', [240, 340]), true);
        assert.equal(lit(realtime, 'qa-builder06-realtime', [240, 260]), false);
        check(
            'Queue worker Lighting mask and HTTP Lighting agree on inside/outside of the merged annex.',
        );
        assert.deepEqual(report.errors, []);
        report.passed = true;
    } finally {
        try {
            if (restore) {
                if (restore.lightingLatest)
                    await api(gm, scene + '/lighting', 'PUT', {
                        expected: restore.lightingLatest,
                        value: restore.lighting,
                    });
                if (restore.original) {
                    const current = (await snapshot()).structure;
                    assert.equal(current.hash, latest, 'Scene changed outside followup');
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
                if (String((await api(gm, campaign)).activeSceneId) !== String(restore.active))
                    await api(gm, campaign + '/activate', 'POST', { sceneId: restore.active });
                fs.unlinkSync(backup);
                report.restored = true;
            }
        } finally {
            fs.writeFileSync(out + '/followup-report.json', JSON.stringify(report, null, 2));
            await browser.close();
        }
    }
})().catch((e) => {
    report.failure = e.message;
    fs.writeFileSync(out + '/followup-report.json', JSON.stringify(report, null, 2));
    console.error(e);
    process.exitCode = 1;
});
