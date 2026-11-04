/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, window */
const assert = require('node:assert/strict'),
    fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, snapshot, tabletop, subscribed, base, scene } = require('./map07a.cjs');
const out = 'artifacts/map07e3/stop';
fs.mkdirSync(out, { recursive: true });
async function point(p, v) {
    const q = await p.evaluate((v) => {
        const a = window.tabletopApp.stage.children[0].toGlobal(v);
        return { x: a.x, y: a.y };
    }, v);
    const b = await tabletop(p).boundingBox();
    return { x: b.x + q.x, y: b.y + q.y };
}
async function click(p, v, d = false) {
    const q = await point(p, v);
    if (d) await p.mouse.dblclick(q.x, q.y, { delay: 60 });
    else await p.mouse.click(q.x, q.y);
}
async function view(p, id) {
    return p.evaluate((id) => {
        const f = (v) =>
            v.model?.id === id && v.badges ? v : (v.children ?? []).map(f).find(Boolean);
        const v = f(window.tabletopApp.stage);
        return { x: v.x, y: v.y, cx: v.model.x, cy: v.model.y };
    }, id);
}
(async () => {
    const b = await chromium.launch({ channel: 'chrome', headless: true });
    let gm,
        baseline,
        active,
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
        if (active !== '5') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
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
        async function place() {
            await api(gm, url, 'PATCH', { x: 300, y: 300 });
            await Promise.all(
                pages.map((p) =>
                    p.waitForFunction((id) => {
                        const f = (v) =>
                            v.model?.id === id && v.badges
                                ? v
                                : (v.children ?? []).map(f).find(Boolean);
                        const v = f(window.tabletopApp.stage);
                        return v.x === 300 && v.model.x === 300;
                    }, t.id),
                ),
            );
        }
        async function stop(combat) {
            await place();
            await click(p, { x: 300, y: 300 });
            const r = p.waitForResponse((r) => r.url().endsWith('/api' + url + '/move'));
            r.catch(() => {});
            await click(p, { x: combat ? 560 : 1000, y: 300 }, true);
            if (combat) {
                const c = p.getByRole('button', { name: 'Подтвердить движение', exact: true });
                await c.waitFor();
                assert.equal(await c.isEnabled(), true);
                await c.click();
            }
            const first = await r;
            assert.equal(first.status(), 200);
            assert.equal(first.request().postDataJSON().instant, false);
            assert.equal(first.request().postDataJSON().routeStep, true);
            await p.keyboard.press('Escape');
            await p.waitForTimeout(1000);
            const s = await snapshot(gm),
                v = s.tokens.find((x) => x.id === t.id);
            assert.ok(v.x > 300 && v.x < (combat ? 560 : 1000));
            await p.waitForTimeout(600);
            assert.equal((await snapshot(gm)).tokens.find((x) => x.id === t.id).x, v.x);
            for (const page of pages) {
                const q = await view(page, t.id);
                assert.equal(q.x, v.x);
                assert.equal(q.cx, v.x);
            }
            if (combat) {
                const budget = s.combat.combatants.find((x) => x.tokenId === t.id).budget;
                assert.ok(budget.movementSpent > 0 && budget.movementSpent < 26);
            }
            await p.screenshot({
                path: out + (combat ? '/combat-stopped.png' : '/exploration-stopped.png'),
            });
            checks.push(
                (combat ? 'Combat' : 'Exploration') +
                    ': Esc stops remainder; three clients retain accepted intermediate endpoint',
            );
        }
        await stop(false);
        await place();
        await click(p, { x: 300, y: 300 });
        const fullFirst = p.waitForResponse((r) => r.url().endsWith('/api' + url + '/move'));
        await click(p, { x: 1000, y: 300 }, true);
        await fullFirst;
        await p.locator('.route-controls').waitFor({ state: 'detached', timeout: 20000 });
        assert.ok((await snapshot(gm)).tokens.find((x) => x.id === t.id).x > 990);
        checks.push('Full exploration route completes all accepted steps');
        await place();
        const from = await point(p, { x: 300, y: 300 }),
            to = await point(p, { x: 460, y: 300 });
        const pending = p.waitForResponse((r) => r.url().endsWith('/api' + url + '/move'));
        await p.mouse.move(from.x, from.y);
        await p.mouse.down();
        await p.mouse.move(to.x, to.y, { steps: 5 });
        await p.mouse.up();
        const drag = await pending;
        assert.equal(drag.status(), 200);
        const result = await drag.json();
        assert.equal(result.tokenMovements[0].instant, true);
        await p.waitForTimeout(100);
        for (const page of pages) {
            const q = await view(page, t.id);
            assert.equal(q.x, result.token.x);
        }
        checks.push('Drag: instant receipt/event; no walk animation on any of three clients');
        const c = baseline.combat;
        combatChanged = true;
        await api(gm, scene + '/combat/begin', 'POST', { combatId: c.id });
        await api(gm, scene + '/combat/current', 'POST', {
            combatId: c.id,
            combatantId: c.combatants.find((x) => x.tokenId === t.id).id,
        });
        await p.waitForTimeout(200);
        await stop(true);
        await place();
        await click(p, { x: 300, y: 300 });
        await click(p, { x: 400, y: 300 }, true);
        await p.getByRole('button', { name: 'Подтвердить движение', exact: true }).click();
        await p.locator('.route-controls').waitFor({ state: 'detached', timeout: 20000 });
        assert.ok((await snapshot(gm)).tokens.find((x) => x.id === t.id).x > 390);
        checks.push('Full Combat route completes multiple steps within TurnBudget');
        assert.deepEqual(errors, []);
    } finally {
        if (gm && baseline) {
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
