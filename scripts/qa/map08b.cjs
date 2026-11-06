/* eslint-disable @typescript-eslint/no-require-imports -- Permanent fixture browser QA. */
/* global require, process, console, window, performance, setTimeout */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const { login, api, tabletop, base } = require('./map07a.cjs');
const scene = '/scenes/7';
const out = path.resolve('artifacts/map08b');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = (p) => api(p, scene + '/snapshot');
async function seen(page, mutation) {
    await page.waitForFunction(
        (id) => window.movementFrames.some((f) => f.includes(id)),
        mutation.mutationId,
    );
}
async function tokenView(page, id) {
    return page.evaluate((id) => {
        const find = (v) => (v.model?.id === id && v.badges ? true : (v.children ?? []).some(find));
        return find(window.tabletopApp.stage);
    }, id);
}
async function focus(page, point) {
    await page.bringToFront();
    await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
    const p = await screen(page, point),
        box = await tabletop(page).boundingBox();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(p.x, p.y);
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(center.x, center.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.mouse.wheel(0, -320);
    await sleep(400);
}
async function screen(page, point) {
    return page.evaluate((point) => {
        const app = window.tabletopApp,
            world = app.stage.children[0];
        const p = world.toGlobal(point),
            box = app.canvas.getBoundingClientRect();
        return { x: p.x + box.x, y: p.y + box.y };
    }, point);
}
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const report = { checks: [], errors: [], latenciesMs: [] };
    let pages,
        gm,
        baseline,
        campaign,
        restored = false;
    const record = (s) => {
        report.checks.push(s);
        console.log(s);
    };
    try {
        pages = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    browser,
                    accounts.find((a) => a.id === id),
                ),
            ),
        );
        [gm] = pages;
        const [, p1, p2] = pages;
        pages.forEach((p) => p.on('pageerror', (e) => report.errors.push(e.message)));
        baseline = await state(gm);
        campaign = await api(gm, '/campaigns/5');
        const hero = baseline.tokens.find((t) => t.ownerUserId === '2');
        const hero2 = baseline.tokens.find((t) => t.ownerUserId === '8');
        const target = baseline.tokens.find((t) => t.name === 'LOS · за дверью');
        const windowTarget = baseline.tokens.find((t) => t.name === 'LOS · за окном');
        const furnitureTarget = baseline.tokens.find((t) => t.name === 'LOS · за мебелью');
        assert.ok(hero && hero2 && target && windowTarget && furnitureTarget);
        assert.notEqual(baseline.combat?.status, 'active');
        await api(gm, '/campaigns/5/activate', 'POST', { sceneId: 7 });
        await api(gm, scene + '/grid', 'PUT', { ...baseline.grid, snap: false });
        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2550, y: 700, size: 30, scale: 1 });
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2200, y: 400, size: 30, scale: 1 });
        await api(gm, scene + '/vision', 'POST', {
            enabled: true,
            observerId: hero.id,
            range: 600,
        });
        await api(gm, scene + '/vision', 'POST', {
            enabled: true,
            observerId: hero2.id,
            range: 600,
        });
        const door = async (open) =>
            api(gm, scene + '/structure', 'POST', {
                door: { id: 'los-corridor-door', open },
                expected: (await state(gm)).structure.hash,
            });
        await door(false);
        await Promise.all(
            pages.map((p, i) =>
                p.goto(base + (i ? '/campaigns/5/play' : '/campaigns/5/scenes/7?mode=session')),
            ),
        );
        await Promise.all(pages.map((p) => tabletop(p).waitFor()));
        await Promise.all(
            pages.map((p) =>
                p.waitForFunction(() =>
                    window.movementFrames.some((f) => f.includes('subscription_succeeded')),
                ),
            ),
        );
        await sleep(500);
        const first = await state(p1),
            second = await state(p2);
        assert.equal(first.vision.enabled, true);
        assert.equal(first.vision.polygons.length, 1);
        assert.ok(!first.tokens.some((t) => t.id === target.id));
        assert.ok(second.tokens.some((t) => t.id === windowTarget.id));
        for (const s of [first, second]) {
            assert.ok(!JSON.stringify(s).includes('blocksVision'));
            assert.ok(!JSON.stringify(s).includes('LOS · скрытый эллипс'));
            assert.ok(!JSON.stringify(s.vision).includes('geometryKey'));
        }
        assert.equal(await tokenView(p1, target.id), false);
        await focus(p1, { x: 2550, y: 700 });
        await p1.screenshot({ path: path.join(out, 'player1-door-closed.png') });
        await focus(p2, { x: 2200, y: 400 });
        await p2.screenshot({ path: path.join(out, 'player2-window.png') });
        await gm.screenshot({ path: path.join(out, 'gm-unrestricted.png') });
        record(
            'Scene 7: GM unrestricted; two separate Players, wall/closed door and transparent window, private collider absent',
        );
        const rotated = await api(gm, '/tokens/' + hero.id, 'PATCH', { rotation: 217 });
        await seen(p1, rotated);
        assert.deepEqual((await state(p1)).vision, first.vision);
        record('360-degree vision is independent of rotation');
        const start = performance.now(),
            opened = await door(true);
        await Promise.all([p1, p2].map((p) => seen(p, opened)));
        report.latenciesMs.push(Math.round(performance.now() - start));
        await p1.waitForFunction((id) => {
            const find = (v) =>
                v.model?.id === id && v.badges ? true : (v.children ?? []).some(find);
            return find(window.tabletopApp.stage);
        }, target.id);
        assert.ok((await state(p1)).tokens.some((t) => t.id === target.id));
        await p1.screenshot({ path: path.join(out, 'player1-door-open.png') });
        const closed = await door(false);
        await seen(p1, closed);
        await sleep(100);
        assert.equal(await tokenView(p1, target.id), false);
        record('Door realtime reveals and removes the NPC without a scene reload');
        const hidden = await api(gm, '/tokens/' + windowTarget.id, 'PATCH', { is_hidden: true });
        await seen(p2, hidden);
        assert.ok(!(await state(p2)).tokens.some((t) => t.id === windowTarget.id));
        await api(gm, '/tokens/' + windowTarget.id, 'PATCH', { is_hidden: windowTarget.isHidden });
        record('GM-hidden overrides a clear visible window');
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2200, y: 950 });
        await api(gm, '/tokens/' + windowTarget.id, 'PATCH', { x: 2120, y: 950 });
        assert.ok(!(await state(p2)).tokens.some((t) => t.id === windowTarget.id));
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2200, y: 400 });
        await api(gm, '/tokens/' + windowTarget.id, 'PATCH', {
            x: windowTarget.x,
            y: windowTarget.y,
        });
        record('Opaque window blocks Player visibility using its own blocksVision flag');
        await api(p1, scene + '/los', 'POST', {}, 403);
        await api(p1, scene + '/vision', 'POST', { enabled: false }, 403);
        await api(
            p1,
            scene + '/interact',
            'POST',
            { kind: 'token', id: target.id, epoch: first.liveRevision },
            404,
        );
        const forbidden = baseline.props.find((p) => p.isHidden);
        if (forbidden?.image?.id)
            await api(p1, '/assets/' + forbidden.image.id + '/thumbnail', 'GET', undefined, 403);
        record(
            'Player denied LOS oracle, vision configuration, unseen interaction and hidden prop asset',
        );
        const union = await api(gm, '/tokens/' + hero2.id, 'PATCH', { owner_user_id: 2 });
        await seen(p1, union);
        assert.equal((await state(p1)).vision.polygons.length, 2);
        assert.equal((await state(p2)).vision.polygons.length, 0);
        await p1.screenshot({ path: path.join(out, 'player1-observer-union.png') });
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { owner_user_id: 8 });
        record(
            'Multiple owned observers union; Player without observers gets a closed mask and no entities',
        );
        const at = await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2800, y: 950 });
        await seen(p1, at);
        assert.ok(!(await state(p1)).tokens.some((t) => t.id === furnitureTarget.id));
        record('Rotated vision-blocking prop hides NPC independently of movement collision');
        // Real UI click-to-move and WASD, in the open lane inside the corridor.
        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2490, y: 700 });
        await p1.reload();
        await tabletop(p1).waitFor();
        await p1.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
        await p1.bringToFront();
        const from = await screen(p1, { x: 2490, y: 700 });
        await p1.mouse.click(from.x, from.y);
        await p1.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
        await p1.evaluate(() => {
            window.visionPaintMs = [];
            const renderer = window.tabletopApp.renderer,
                original = renderer.render.bind(renderer);
            renderer.render = (options) => {
                const start = performance.now();
                const result = original(options);
                if (options?.target?.width === 3300)
                    window.visionPaintMs.push(performance.now() - start);
                return result;
            };
        });
        const stepResponse = p1.waitForResponse((r) => r.url().endsWith('/control/step') && r.ok());
        await p1.keyboard.down('w');
        await sleep(420);
        await p1.keyboard.up('w');
        const step = await (await stepResponse).json();
        assert.ok(step.vision?.enabled);
        assert.ok(step.token.y < 700);
        record('Actual Player WASD updates authoritative vision');
        await p1.keyboard.press('Escape');
        await sleep(400);
        const moved = (await state(p1)).tokens.find((t) => t.id === hero.id);
        const tokenPoint = await screen(p1, moved);
        await p1.mouse.click(tokenPoint.x, tokenPoint.y);
        const destination = await screen(p1, { x: 2490, y: 720 });
        const clickResponse = p1.waitForResponse((r) => r.url().endsWith('/move'));
        await p1.mouse.dblclick(destination.x, destination.y);
        await sleep(500);
        await p1.screenshot({ path: path.join(out, 'click-to-move.png') });
        const clickHttp = await clickResponse;
        assert.equal(clickHttp.status(), 200);
        const click = await clickHttp.json();
        assert.ok(click.vision?.enabled);
        await sleep(500);
        report.gpuMaskSubmissionMs = await p1.evaluate(() => [...window.visionPaintMs]);
        assert.ok(report.gpuMaskSubmissionMs.length > 0);
        record(
            'Actual Player WASD and Click-to-Move return authoritative vision with accepted movement',
        );
        await p1.evaluate(() => window.movementDisconnect());
        await sleep(200);
        await p1.reload();
        await tabletop(p1).waitFor();
        await sleep(500);
        const reconnect = await state(p1);
        assert.equal(reconnect.vision.enabled, true);
        assert.ok(!reconnect.tokens.some((t) => t.id === target.id));
        record('Reconnect hydrates current mask and filtered entities without ghost NPCs');
        // No polygon endpoint requests are emitted by pan/zoom; vision travels only with domain revisions.
        let cameraRequests = 0;
        const observeRequest = (r) => {
            if (/\/(snapshot|los|vision)$/.test(r.url())) cameraRequests++;
        };
        p1.on('request', observeRequest);
        const beforeFrames = await p1.evaluate(() => window.movementFrames.length);
        await p1.mouse.move(900, 500);
        await p1.mouse.wheel(0, -200);
        await sleep(200);
        assert.ok((await p1.evaluate(() => window.movementFrames.length)) - beforeFrames < 10);
        p1.off('request', observeRequest);
        assert.equal(cameraRequests, 0);
        record('Camera zoom does not request/recompute domain visibility');
        await gm.goto(base + '/campaigns/5/scenes/7');
        const libraryClose = gm.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
        if (await libraryClose.isVisible()) await libraryClose.click();
        await gm
            .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
            .click();
        await gm.getByRole('button', { name: 'LOS debug', exact: true }).click();
        await gm.getByLabel('LOS наблюдатель', { exact: true }).selectOption(hero.id);
        await gm.waitForResponse((r) => r.url().endsWith('/los') && r.ok());
        await gm.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
        await sleep(300);
        await gm.screenshot({ path: path.join(out, 'gm-vision-debug.png') });
        record('GM debug displays the authoritative 360-degree visibility polygon');
        assert.deepEqual(report.errors, []);
    } finally {
        if (gm && baseline) {
            for (const token of baseline.tokens) {
                await api(gm, '/tokens/' + token.id, 'PATCH', {
                    x: token.x,
                    y: token.y,
                    rotation: token.rotation,
                    size: token.size,
                    scale: token.scale,
                    owner_user_id: token.ownerUserId ? Number(token.ownerUserId) : null,
                    is_hidden: token.isHidden,
                    vision_range: token.visionRange,
                });
            }
            const current = await state(gm);
            if (current.structure.hash !== baseline.structure.hash)
                await api(gm, scene + '/structure', 'POST', {
                    value: baseline.structure.graph,
                    expected: current.structure.hash,
                });
            await api(gm, scene + '/vision', 'POST', { enabled: baseline.vision.enabled });
            await api(gm, scene + '/grid', 'PUT', baseline.grid);
            if (campaign)
                await api(gm, '/campaigns/5/activate', 'POST', {
                    sceneId: campaign.activeSceneId ? Number(campaign.activeSceneId) : null,
                });
            const final = await state(gm);
            assert.deepEqual(final.tokens, baseline.tokens);
            assert.deepEqual(final.structure, baseline.structure);
            assert.deepEqual(final.vision, baseline.vision);
            assert.deepEqual(final.grid, baseline.grid);
            restored = true;
        }
        report.restored = restored;
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
