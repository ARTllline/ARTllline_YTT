/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, window */
const fs = require('node:fs'),
    assert = require('node:assert/strict');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const {
    api,
    login,
    snapshot,
    mapState,
    tabletop,
    subscribed,
    base,
    scene,
} = require('./map07a.cjs');
const out = 'artifacts/map07e3/drag-route';
fs.mkdirSync(out, { recursive: true });
async function point(p, v) {
    const q = await p.evaluate((v) => {
        const a = window.tabletopApp.stage.children[0].toGlobal(v);
        return { x: a.x, y: a.y };
    }, v);
    const b = await tabletop(p).boundingBox();
    return { x: b.x + q.x, y: b.y + q.y };
}
async function pos(p, id) {
    return p.evaluate((id) => {
        const f = (v) =>
            v.model?.id === id && v.badges ? v : (v.children ?? []).map(f).find(Boolean);
        const v = f(window.tabletopApp.stage);
        return { x: v.x, y: v.y };
    }, id);
}
(async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    let gm,
        baseline,
        active,
        edit,
        mapChanged = false,
        combatChanged = false;
    const checks = [],
        errors = [];
    try {
        const a = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        const pages = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    b,
                    a.find((x) => x.id === id),
                ),
            ),
        );
        [gm] = pages;
        const p = pages[1];
        pages.forEach((p) => p.on('pageerror', (e) => errors.push(e.message)));
        baseline = await snapshot(gm);
        active = (await api(gm, '/campaigns/5')).activeSceneId;
        assert.notEqual(baseline.combat?.status, 'active');
        assert.equal(baseline.structure?.graph.edges.length ?? 0, 0);
        if (active !== '5') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
        if (!baseline.mapWorld) {
            const expected = mapState(baseline);
            await api(gm, scene + '/map-world', 'POST', {
                expected,
                value: { ...expected, enabled: true },
            });
            mapChanged = true;
        }
        await api(gm, scene + '/grid', 'PUT', { ...baseline.grid, snap: false });
        await Promise.all(
            pages.map((p, i) =>
                p.goto(base + (i ? '/campaigns/5/play' : '/campaigns/5/scenes/5?mode=session')),
            ),
        );
        await Promise.all(pages.map(subscribed));
        await Promise.all(pages.map((p) => tabletop(p).waitFor()));
        const t = baseline.tokens.find((t) => t.ownerUserId === '2'),
            url = '/tokens/' + t.id;
        await p.evaluate(() => {
            const Native = window.Worker;
            window.dragPreviewResults = [];
            window.Worker = class extends Native {
                constructor(...args) {
                    super(...args);
                    this.addEventListener('message', (e) => window.dragPreviewResults.push(e.data));
                }
            };
        });
        async function wall(x, y, h) {
            const r = await api(gm, scene + '/structure', 'POST', {
                expected: (await snapshot(gm)).structure.hash,
                value: {
                    vertices: [
                        { id: 'a', x, y },
                        { id: 'b', x, y: y + h },
                    ],
                    edges: [
                        {
                            id: 'wall',
                            a: 'a',
                            b: 'b',
                            thickness: 8,
                            materialVersionId: null,
                            blocksMovement: true,
                            blocksVision: true,
                            blocksLight: true,
                        },
                    ],
                    rooms: [],
                    openings: [],
                },
            });
            if (!edit) edit = r.structureEdit;
            else edit.after = r.structureEdit.after;
            await p.waitForTimeout(150);
        }
        async function place(v) {
            await api(gm, url, 'PATCH', v);
            await p.waitForTimeout(200);
        }
        async function drag(from, to) {
            const x = await point(p, from),
                y = await point(p, to);
            const pending = p.waitForResponse((r) => r.url().endsWith('/api' + url + '/move'));
            pending.catch(() => {});
            await p.mouse.move(x.x, x.y);
            await p.mouse.down();
            await p.mouse.move(y.x, y.y, { steps: 6 });
            await p.waitForFunction(() => {
                const layer = window.tabletopApp.stage.children[0].children.find(
                    (c) => c.movementLabel,
                );
                return (
                    layer?.movementLabel.visible &&
                    window.dragPreviewResults.at(-1)?.status === 'found'
                );
            });
            const preview = await p.evaluate(() => {
                const layer = window.tabletopApp.stage.children[0].children.find(
                    (c) => c.movementLabel,
                );
                return { route: window.dragPreviewResults.at(-1), label: layer.movementLabel.text };
            });
            assert.ok(preview.route.path.length > 2);
            assert.ok(preview.route.length > Math.hypot(to.x - from.x, to.y - from.y));
            assert.equal(
                Number(preview.label.replace(',', '.').split(' ')[0]),
                Number(
                    (
                        (preview.route.length / baseline.grid.size) *
                        baseline.grid.distancePerCell
                    ).toFixed(1),
                ),
            );
            await p.screenshot({ path: out + '/live-preview-' + checks.length + '.png' });
            await p.mouse.up();
            const r = await pending;
            assert.equal(r.status(), 200);
            const result = await r.json();
            assert.ok(result.tokenMovements[0].path.length > 2);
            assert.deepEqual(result.tokenMovements[0].path, preview.route.path);
            assert.equal(result.tokenMovements[0].instant, true);
            assert.equal(r.request().postDataJSON().routeStep, false);
            await p.waitForTimeout(150);
            for (const q of pages)
                assert.deepEqual(await pos(q, t.id), { x: result.token.x, y: result.token.y });
            return result;
        }
        await wall(450, 180, 240);
        await place({ x: 300, y: 300 });
        await drag({ x: 300, y: 300 }, { x: 600, y: 300 });
        checks.push(
            'Player Drag finds a detour around wall and lands instantly for GM + 2 Players',
        );
        await p.screenshot({ path: out + '/detour.png' });
        await place({ x: 300, y: 300 });
        let requests = 0;
        const count = (r) => {
            if (r.url().endsWith('/api' + url + '/move')) requests++;
        };
        p.on('request', count);
        const x = await point(p, { x: 300, y: 300 }),
            y = await point(p, { x: 450, y: 300 });
        await p.mouse.move(x.x, x.y);
        await p.mouse.down();
        await p.mouse.move(y.x, y.y, { steps: 5 });
        await p.waitForFunction(() => window.dragPreviewResults.at(-1)?.status === 'unreachable');
        await p.screenshot({ path: out + '/live-preview-unreachable.png' });
        await p.mouse.up();
        await p.getByText(/Маршрут не найден/).waitFor();
        assert.equal(requests, 0);
        p.off('request', count);
        await p.keyboard.press('Escape');
        checks.push('Target inside wall is refused without sending movement');
        await wall(390, 260, 80);
        await place({ x: 330, y: 300 });
        const c = baseline.combat;
        combatChanged = true;
        await api(gm, scene + '/combat/begin', 'POST', { combatId: c.id });
        await api(gm, scene + '/combat/current', 'POST', {
            combatId: c.id,
            combatantId: c.combatants.find((x) => x.tokenId === t.id).id,
        });
        await p.waitForTimeout(250);
        await drag({ x: 330, y: 300 }, { x: 450, y: 300 });
        const budget = (await snapshot(gm)).combat.combatants.find(
            (x) => x.tokenId === t.id,
        ).budget;
        assert.ok(budget.movementSpent > (120 / baseline.grid.size) * 5);
        checks.push('Combat Drag spends actual detour cost, not straight-line distance');
        assert.deepEqual(errors, []);
    } finally {
        if (gm && baseline) {
            if (edit)
                await api(gm, scene + '/edit-history', 'POST', {
                    changes: [
                        { kind: 'structure', id: '5', expected: edit.after, value: edit.before },
                    ],
                });
            if (combatChanged)
                require('node:child_process').execFileSync('php', ['artisan', 'qa:townhouse'], {
                    stdio: 'pipe',
                });
            for (const t of baseline.tokens)
                await api(gm, '/tokens/' + t.id, 'PATCH', {
                    x: t.x,
                    y: t.y,
                    size: t.size,
                    scale: t.scale,
                });
            await api(gm, scene + '/grid', 'PUT', baseline.grid);
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
            if (active && active !== '5')
                await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
            checks.push('Fixture restored');
        }
        fs.writeFileSync(out + '/report.json', JSON.stringify({ checks, errors }, null, 2));
        await b.close();
        console.log(JSON.stringify({ checks, errors }));
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
