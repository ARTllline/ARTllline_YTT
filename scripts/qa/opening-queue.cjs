/* eslint-disable @typescript-eslint/no-require-imports -- Reversible QA on permanent Scene 7. */
/* global require, process, console, window, document, setTimeout */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, subscribed, base } = require('./map07a.cjs');
const scene = '/scenes/7';
const out = 'artifacts/opening-queue';
const backup = out + '/restore.private.json';
const report = { checks: [], errors: [], passed: false, restored: false };
const check = (text) => {
    report.checks.push(text);
    console.log(text);
};
const button = (p, name) => p.getByRole('button', { name, exact: true });
const snapshot = (p) => api(p, scene + '/snapshot');
async function editor(p) {
    await tabletop(p).waitFor();
    if (await button(p, 'Закрыть библиотеку').isVisible())
        await button(p, 'Закрыть библиотеку').click();
    await button(p, 'Редактировать карту').click();
    await button(p, 'Build').click();
}
async function screen(p, x, y) {
    const box = await tabletop(p).boundingBox();
    return p.evaluate(
        ({ box, x, y }) => {
            const world = window.tabletopApp.stage.children[0];
            return [box.x + world.x + x * world.scale.x, box.y + world.y + y * world.scale.y];
        },
        { box, x, y },
    );
}
async function align(p) {
    const box = await tabletop(p).boundingBox();
    const center = [box.x + box.width * 0.5, box.y + box.height * 0.5];
    for (let i = 0; i < 12; i++) {
        const zoom = await p.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
        if (Math.abs(zoom - 0.7) < 0.001) break;
        await p.mouse.move(...center);
        await p.mouse.wheel(0, -Math.log(0.7 / zoom) / 0.002);
        await p.waitForTimeout(140);
    }
    const origin = await screen(p, 850, 400);
    await p.mouse.move(...center);
    await p.keyboard.down('Space');
    await p.mouse.down();
    await p.mouse.move(2 * center[0] - origin[0], 2 * center[1] - origin[1], { steps: 6 });
    await p.mouse.up();
    await p.keyboard.up('Space');
}
(async () => {
    fs.mkdirSync(out, { recursive: true });
    assert.ok(!fs.existsSync(backup), 'Restore prior QA run first');
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, restore, latest, original, active;
    const responses = [];
    try {
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
        await gm.goto(base + '/campaigns/5/scenes/7?mode=prepare');
        original = await snapshot(gm);
        assert.ok(
            !original.structure.graph.openings?.some((o) => o.edgeId === 'north'),
            'North wall must be free',
        );
        active = (await api(gm, '/campaigns/5')).activeSceneId;
        if (String(active) !== '7') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: 7 });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
            options,
        );
        await player.goto(base + '/campaigns/5/play');
        await tabletop(player).waitFor();
        await subscribed(player);
        for (const p of [gm, player]) p.on('pageerror', (e) => report.errors.push(e.message));
        gm.on('response', async (r) => {
            if (
                !r.url().match(/\/api\/scenes\/7\/(structure|edit-history)$/) ||
                r.request().method() !== 'POST'
            )
                return;
            const body = await r.json();
            responses.push({ status: r.status(), body });
            if (body.structure) {
                latest = body.structure.hash;
                restore ??= body.structureEdit?.before;
                if (restore)
                    fs.writeFileSync(backup, JSON.stringify({ original: restore, latest }));
            }
        });
        await editor(gm);
        await align(gm);
        const click = async (x) => {
            const xy = await screen(gm, x, 220);
            assert.equal(
                await gm.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, xy),
                'CANVAS',
            );
            await gm.mouse.click(...xy);
        };
        let delay = 1000;
        await gm.route('**/api/scenes/7/structure', async (route) => {
            if (route.request().method() === 'POST')
                await new Promise((resolve) => setTimeout(resolve, delay));
            await route.continue();
        });
        await button(gm, 'Дверь').click();
        for (let i = 0; i < 12; i++) {
            if (i === 6) await button(gm, 'Окно').click();
            await click(120 + i * 110);
        }
        await gm.screenshot({ path: out + '/pending.png' });
        await button(gm, 'Правка').click();
        await gm.locator('.map-editor-status .save-saved').waitFor({ timeout: 30000 });
        const north = (s) => (s.structure.graph.openings ?? []).filter((o) => o.edgeId === 'north');
        await gm.screenshot({ path: out + '/drained.png' });
        report.responses = responses.map((r) => ({ status: r.status, message: r.body.message }));
        report.status = await gm.locator('.build-hint').innerText();
        assert.equal(north(await snapshot(gm)).length, 12);
        assert.equal(responses.filter((r) => r.status === 200).length, 12);
        assert.equal(north(await snapshot(gm)).filter((o) => o.type === 'window').length, 6);
        check(
            '12 mixed door/window clicks with 1000ms HTTP delay; switching tools preserves queued intents',
        );
        await player.waitForFunction(
            () => window.movementFrames.filter((s) => s.includes('structurePatch')).length >= 12,
        );
        assert.equal(north(await snapshot(player)).length, 12);
        check('Player received incremental structure events');
        await gm.screenshot({ path: out + '/confirmed.png' });
        delay = 0;
        for (const redo of [false, true]) {
            for (let i = 0; i < 12; i++) {
                const done = gm.waitForResponse(
                    (r) => r.url().endsWith('/edit-history') && r.request().method() === 'POST',
                );
                await button(gm, redo ? 'Повторить правку' : 'Отменить правку').click();
                assert.equal((await done).status(), 200);
                await gm.locator('.map-editor-status .save-saved').waitFor();
                assert.equal(north(await snapshot(gm)).length, redo ? i + 1 : 11 - i);
            }
        }
        check('Undo and Redo each of all 12 openings independently');
        // Queue a duplicate (local rejection), a server rejection, then a valid opening.
        await button(gm, 'Дверь').click();
        await click(120);
        await gm.getByRole('status').filter({ hasText: 'отклонено 1' }).waitFor();
        let reject = true;
        await gm.unroute('**/api/scenes/7/structure');
        await gm.route('**/api/scenes/7/structure', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 800));
            if (reject) {
                reject = false;
                await route.fulfill({
                    status: 422,
                    contentType: 'application/json',
                    body: JSON.stringify({ message: 'QA rejection' }),
                });
            } else await route.continue();
        });
        await click(1490);
        await click(1600);
        await gm.locator('.map-editor-status .save-saved').waitFor({ timeout: 15000 });
        assert.equal(north(await snapshot(gm)).length, 13);
        assert.match(await gm.locator('.map-editor-status').innerText(), /есть отклонённые проёмы/);
        check('Duplicate and definitive HTTP rejection do not confirm or block the next placement');
        await gm.unroute('**/api/scenes/7/structure');
        await gm.route('**/api/scenes/7/structure', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await route.continue();
        });
        await click(1710);
        await click(1820);
        await click(1900);
        await gm.keyboard.press('Escape');
        await gm.locator('.map-editor-status .save-saved').waitFor({ timeout: 15000 });
        assert.equal(north(await snapshot(gm)).length, 14);
        check('Escape cancels unsent clicks and preserves the active/confirmed writes');
        await gm.reload();
        await tabletop(gm).waitFor();
        assert.equal(north(await snapshot(gm)).length, 14);
        assert.deepEqual(report.errors, []);
        check(
            'Reload preserves all confirmed openings without restoring pending/rejected previews',
        );
        report.passed = true;
    } finally {
        try {
            if (gm) {
                await gm.unroute('**/api/scenes/7/structure');
                if (restore) {
                    const current = await snapshot(gm);
                    assert.equal(
                        current.structure.hash,
                        latest,
                        'Concurrent edit: do not overwrite',
                    );
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '7',
                                expected: { hash: latest },
                                value: restore,
                            },
                        ],
                    });
                    assert.equal((await snapshot(gm)).structure.hash, original.structure.hash);
                    fs.unlinkSync(backup);
                    report.restored = true;
                }
                if (active && String(active) !== '7')
                    await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
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
