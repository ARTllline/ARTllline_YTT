/* eslint-disable @typescript-eslint/no-require-imports -- Reversible browser QA on Scene 7. */
/* global require, process, console, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, base } = require('./map07a.cjs');
const scene = '/scenes/7';
const campaign = '/campaigns/5';
const out = 'artifacts/map10b';
const backup = out + '/restore.private.json';
const state = (page) => api(page, scene + '/snapshot');
const memory = (action) =>
    execFileSync('php', ['scripts/qa/fog-memory-fixture.php', action], { stdio: 'pipe' });
const move = (gm, token, patch) => api(gm, '/tokens/' + token.id, 'PATCH', patch);
const graph = async (gm, value) =>
    api(gm, scene + '/structure', 'POST', { value, expected: (await state(gm)).structure.hash });
const lighting = async (gm, value) =>
    api(gm, scene + '/lighting', 'PUT', { value, expected: (await state(gm)).lighting });
const rules = (gm, character, value) =>
    api(gm, campaign + '/characters', 'POST', { id: character.id, name: character.name, rules: value });
const has = (snapshot, token) => snapshot.tokens.some((entry) => entry.id === token.id);
const source = (id, x, y, tokenId = null, radius = 330) => ({
    id, name: id, enabled: true, x, y, tokenId, radius, color: '#ffc078', intensity: 1, falloff: 1,
});
async function waitForToken(page, token, visible) {
    await page.waitForFunction(({ id, visible }) => {
        const find = (node) => (node.model?.id === id && node.badges) || (node.children ?? []).some(find);
        return !!find(window.tabletopApp.stage) === visible;
    }, { id: token.id, visible }, { timeout: 20000 });
}
async function ready(page) {
    await tabletop(page).waitFor({ timeout: 60000 });
    await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.movementFrames.some((frame) => frame.includes('subscription_succeeded')), undefined, { timeout: 20000 });
}
async function maskPixel(page, point) {
    return page.evaluate(({ x, y }) => {
        const app = window.tabletopApp;
        const layer = app.stage.children[0].children.find((child) => child.currentMask);
        const { pixels, width } = app.renderer.extract.pixels({ target: layer.currentMask.texture });
        const offset = (Math.floor(y) * width + Math.floor(x)) * 4;
        return Array.from(pixels.slice(offset, offset + 4));
    }, { x: point.x, y: point.y });
}
async function restore(gm, saved) {
    const { baseline, active, characters, tokens } = saved;
    for (const c of characters) await rules(gm, c, c.rules ?? null);
    for (const token of tokens)
        await move(gm, token, { x: token.x, y: token.y, size: token.size, scale: token.scale, vision_range: token.visionRange });
    if ((await state(gm)).structure.hash !== baseline.structure.hash)
        await graph(gm, baseline.structure.graph);
    await lighting(gm, baseline.lighting);
    await api(gm, scene + '/vision', 'POST', { enabled: baseline.vision.enabled, memoryPolicy: baseline.vision.memoryPolicy });
    await api(gm, campaign + '/activate', 'POST', { sceneId: active });
    const current = await state(gm);
    assert.deepEqual(current.tokens, baseline.tokens);
    assert.deepEqual(current.vision, baseline.vision);
    assert.deepEqual(current.structure, baseline.structure);
    assert.deepEqual(current.lighting, baseline.lighting);
    for (const c of characters)
        assert.deepEqual(current.characters.find((item) => item.id === c.id).rules, c.rules);
}
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const report = { checks: [], errors: [], restored: false };
    let gm, saved, backed = false;
    try {
        if (process.argv.includes('--restore')) {
            gm = await login(browser, accounts.find((a) => a.id === 1));
            saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
            backed = true;
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore the previous Scene 7 backup first.');
        const pages = await Promise.all([1, 2, 8].map((id) => login(browser, accounts.find((a) => a.id === id))));
        [gm] = pages;
        const [, p1, p2] = pages;
        pages.forEach((p) => p.on('pageerror', (e) => report.errors.push(e.message)));
        memory('backup');
        backed = true;
        const baseline = await state(gm);
        const first = baseline.tokens.find((t) => t.ownerUserId === '2');
        const second = baseline.tokens.find((t) => t.ownerUserId === '8');
        const doorTarget = baseline.tokens.find((t) => t.name === 'LOS · за дверью');
        const windowTarget = baseline.tokens.find((t) => t.name === 'LOS · за окном');
        assert.ok(first && second && doorTarget && windowTarget);
        const characters = [first, second].map((token) => baseline.characters.find((c) => c.id === token.characterId));
        assert.ok(characters.every((c) => c?.rules || c?.rulesSuggestion));
        saved = { baseline, characters, tokens: [first, second], active: (await api(gm, campaign)).activeSceneId };
        fs.writeFileSync(backup, JSON.stringify(saved));
        const door = (open) => graph(gm, {
            ...baseline.structure.graph,
            openings: baseline.structure.graph.openings.map((opening) =>
                opening.id === 'los-corridor-door' ? { ...opening, open } : opening,
            ),
        });
        const sight = (character, feet) => rules(gm, character, {
            ...(character.rules ?? character.rulesSuggestion), senses: { darkvision_ft: feet },
        });
        const light = (brightness, sources = []) => lighting(gm, {
            enabled: true, mode: brightness === 1 ? 'day' : 'night', brightness, color: '#ffffff', sources,
        });
        await api(gm, campaign + '/activate', 'POST', { sceneId: 7 });
        await api(gm, scene + '/vision', 'POST', { enabled: true });
        await move(gm, first, { x: 2550, y: 700, size: 30, scale: 1, vision_range: 600 });
        await move(gm, second, { x: 2530, y: 700, size: 30, scale: 1, vision_range: 600 });
        await sight(characters[0], 0);
        await sight(characters[1], 0);
        await door(true);
        await light(1);
        await Promise.all(pages.map((p, i) => p.goto(base + (i ? campaign + '/play' : campaign + '/scenes/7?mode=session'))));
        await Promise.all(pages.map(ready));
        await Promise.all(pages.map((p) => waitForToken(p, doorTarget, true)));
        await light(.2);
        assert.ok(has(await state(p1), doorTarget) && has(await state(p2), doorTarget));
        const explored = (await state(p1)).vision.explored.bits;
        await light(0);
        await Promise.all([waitForToken(gm, doorTarget, true), waitForToken(p1, doorTarget, false), waitForToken(p2, doorTarget, false)]);
        const dark = await state(p1);
        assert.equal(dark.vision.explored.bits, explored);
        assert.ok(!has(dark, doorTarget) && dark.vision.raster);
        assert.equal((await maskPixel(p1, doorTarget))[3], 0);
        await api(p1, scene + '/interact', 'POST', { kind: 'token', id: doorTarget.id, epoch: dark.liveRevision }, 404);
        report.checks.push('Bright/dim, darkness, GM view, recipient revocation, Fog memory and targeting');

        await sight(characters[1], 60);
        await waitForToken(p2, doorTarget, true);
        assert.ok((await state(p2)).vision.raster.darkvision);
        assert.ok(!has(await state(p1), doorTarget));
        assert.deepEqual(await maskPixel(p2, doorTarget), [255, 0, 0, 255]);
        await p2.screenshot({ path: out + '/player-darkvision.png' });
        await door(false);
        await waitForToken(p2, doorTarget, false);
        await sight(characters[1], 0);
        const torch = source('qa-character-torch', 2550, 700, first.id);
        await light(0, [torch, source('qa-other-light', 3050, 1250, null, 160)]);
        assert.ok(!has(await state(p1), doorTarget));
        await door(true);
        await Promise.all([waitForToken(p1, doorTarget, true), waitForToken(p2, doorTarget, true)]);
        assert.deepEqual(await maskPixel(p1, doorTarget), [255, 255, 255, 255]);
        await move(gm, first, { x: 2350, y: 1250 });
        await waitForToken(p2, doorTarget, false);
        report.checks.push('Darkvision recipient/range, wall/door occlusion and multiple lights with a moving torch');

        await move(gm, second, { x: 2200, y: 400 });
        await light(0, [source('qa-window-torch', 2200, 400, second.id, 250)]);
        const aperture = baseline.structure.graph.openings.find((opening) => opening.id === 'los-clear-window');
        assert.ok(aperture, 'Expected a transparent window in the LOS wing');
        for (const blocksLight of [true, false]) {
            await graph(gm, {
                ...baseline.structure.graph,
                openings: baseline.structure.graph.openings.map((opening) =>
                    opening.id === aperture.id ? { ...opening, blocksLight } : opening,
                ),
            });
            await waitForToken(p2, windowTarget, !blocksLight);
        }
        report.checks.push('A transparent window independently blocks or passes light');
        await light(0);
        await p2.evaluate(() => window.movementDisconnect());
        await p2.reload();
        await ready(p2);
        await waitForToken(p2, windowTarget, false);
        assert.ok(!has(await state(p2), windowTarget));
        report.checks.push('Reconnect hydrates the latest authorized snapshot');
        assert.deepEqual(report.errors, []);
    } catch (error) {
        report.failure = error.message;
        throw error;
    } finally {
        try {
            if (gm && saved) await restore(gm, saved);
            await browser.close();
            if (backed) memory('restore');
            if (saved) fs.rmSync(backup);
            report.restored = !!saved;
        } finally {
            await browser.close();
            fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        }
    }
    console.log(report);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
