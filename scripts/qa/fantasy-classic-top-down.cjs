/* eslint-disable @typescript-eslint/no-require-imports -- Chromium acceptance on Scene 11. */
/* global require, process, console, window */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, base, login, subscribed, tabletop } = require('./map07a.cjs');
const { align } = require('./builder06.cjs');
const pack = require('../../resources/environment/fantasy-classic/manifest.json');

const out = 'artifacts/map-p2c-top-down';
const scene = '/scenes/11';
const packUrl = '/library/object-presets?source=builtin';
const phase = process.argv[2];
const file = (name) => out + '/' + name;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function assets(page, path) {
    const response = await page.request.get(base + path);
    assert.equal(response.status(), 200, path);
    assert.match(response.headers()['content-type'], /^image\/webp/);
    return digest(await response.body());
}

async function capture(page, label, zoom, center) {
    await align(page, zoom, center);
    await page.waitForFunction(
        (zoom) => Math.abs(window.tabletopApp.stage.children[0].scale.x - zoom) < 0.005,
        zoom,
    );
    await page.waitForTimeout(500);
    await tabletop(page).screenshot({ path: file(phase + '-' + label + '.png') });
}

(async () => {
    assert.ok(['before', 'after'].includes(phase));
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await login(
            browser,
            accounts.find((account) => account.id === 1),
            {
                viewport: { width: 1680, height: 1060 },
                reducedMotion: 'reduce',
            },
        );
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error') errors.push(message.text());
        });
        await page.goto(base + '/campaigns/5' + scene + '?mode=prepare');
        await tabletop(page).waitFor();
        await subscribed(page);
        await page.locator('.scene-loading-indicator').waitFor({ state: 'hidden' });
        await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
        const close = page.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
        if (await close.isVisible()) await close.click();
        const snapshot = await api(page, scene + '/snapshot');
        assert.equal(snapshot.name, 'Лесная таверна · Fantasy Classic');
        const light = await api(page, scene + '/lighting');
        const { presets } = await api(page, packUrl);
        assert.equal(presets.length, pack.objects.length);
        const props = [];
        for (const item of pack.objects) {
            const preset = presets.find((candidate) => candidate.name === item.name);
            assert.ok(preset, item.key);
            const original = await assets(page, preset.asset.url);
            const thumbnail = await assets(page, preset.thumbnailUrl);
            assert.equal(
                original,
                phase === 'before' ? item.sha256 : (item.artwork?.sha256 ?? item.sha256),
                item.key,
            );
            props.push({ key: item.key, preset, original, thumbnail });
        }
        const state = { props, snapshot, light };
        if (phase === 'after') {
            const before = JSON.parse(fs.readFileSync(file('before-state.json')));
            assert.deepEqual(snapshot, before.snapshot, 'Scene projection changed');
            assert.deepEqual(light, before.light, 'Scene lighting changed');
            for (const [i, current] of props.entries()) {
                const previous = before.props[i];
                assert.deepEqual(
                    current.preset,
                    previous.preset,
                    current.key + ' preset or asset metadata',
                );
                if (current.original === previous.original)
                    assert.equal(current.thumbnail, previous.thumbnail);
                else
                    assert.notEqual(
                        current.thumbnail,
                        previous.thumbnail,
                        current.key + ' stale thumbnail',
                    );
            }
            await page.reload();
            await tabletop(page).waitFor();
            await subscribed(page);
            await page.locator('.scene-loading-indicator').waitFor({ state: 'hidden' });
            await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
            if (await close.isVisible()) await close.click();
            assert.deepEqual(await api(page, scene + '/snapshot'), snapshot);
            const lamp = props.find((prop) => prop.key === 'iron-lantern');
            assert.equal(await assets(page, lamp.preset.asset.url), lamp.original);
        }
        await capture(page, '100', 1, [720, 500]);
        await capture(page, '175-interior', 1.75, [742, 443]);
        await capture(page, '175-kitchen', 1.75, [1025, 365]);
        assert.deepEqual(errors, []);
        fs.writeFileSync(file(phase + '-state.json'), JSON.stringify(state, null, 2));
        console.log(
            `${phase}: ${snapshot.props.length} placed props, ${props.length} presets, ${light.sources.length} lights`,
        );
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
