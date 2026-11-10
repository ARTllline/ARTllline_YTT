/* eslint-disable @typescript-eslint/no-require-imports -- QA on existing Scenes 8–10. */
/* global require, process, console, window, requestAnimationFrame */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, base, login, subscribed, tabletop } = require('./map07a.cjs');
const { align } = require('./builder06.cjs');

const out = 'artifacts/map-p2b';
const campaign = '/campaigns/5';
const recoveryPath = out + '/restore.private.json';
const options = {
    viewport: { width: 1500, height: 960 },
    extraHTTPHeaders: { 'X-YTT-Perf': '1', 'X-YTT-Perf-Exploration': '0' },
};
const profiles = {
    day: [1, '#fff5e6', false],
    evening: [0.32, '#929dc9', true],
    night: [0, '#7384aa', true],
    'night-unlit': [0, '#7384aa', false],
};
const snapshot = (page, id) => api(page, '/scenes/' + id + '/snapshot');

async function setLighting(page, id, value) {
    const { lighting: expected } = await snapshot(page, id);
    if (JSON.stringify(expected) !== JSON.stringify(value))
        await api(page, '/scenes/' + id + '/lighting', 'PUT', { expected, value });
    assert.deepEqual((await snapshot(page, id)).lighting, value);
}

async function restore(page, backup) {
    for (const [id, lighting] of Object.entries(backup.lighting))
        await setLighting(page, id, lighting);
    if (String((await api(page, campaign)).activeSceneId) !== String(backup.active))
        await api(page, campaign + '/activate', 'POST', { sceneId: backup.active });
    assert.equal(String((await api(page, campaign)).activeSceneId), String(backup.active));
    fs.unlinkSync(recoveryPath);
}

async function ready(page) {
    await tabletop(page).waitFor();
    await subscribed(page);
    await page.locator('.scene-loading-indicator').waitFor({ state: 'hidden' });
    await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.media-state').count(), 0);
}

async function capture(page, dir, name, zoom, center, measure) {
    await align(page, zoom, center);
    const actual = await page.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
    assert.ok(Math.abs(actual - zoom) < 0.01, 'Unexpected camera zoom: ' + actual);
    await page.waitForTimeout(350);
    const frames = measure
        ? await page.evaluate(async () => {
              const intervals = [];
              await new Promise((resolve) => {
                  let previous;
                  const step = (now) => {
                      if (previous !== undefined) intervals.push(now - previous);
                      previous = now;
                      if (intervals.length < 90) requestAnimationFrame(step);
                      else resolve();
                  };
                  requestAnimationFrame(step);
              });
              intervals.sort((a, b) => a - b);
              return { median: intervals[45], p95: intervals[85], p99: intervals[89] };
          })
        : undefined;
    await tabletop(page).screenshot({ path: dir + '/' + name + '.png' });
    return frames;
}

async function lightPeak(page) {
    return page.evaluate(() => {
        const app = window.tabletopApp;
        const light = app.stage.children[0].children.find(
            (layer) => layer.metrics?.maskUploads !== undefined,
        );
        const { pixels } = app.renderer.extract.pixels({ target: light.target });
        let peak = 0;
        for (let i = 0; i < pixels.length; i += 4)
            peak = Math.max(peak, pixels[i], pixels[i + 1], pixels[i + 2]);
        return peak;
    });
}

(async () => {
    const phase = process.argv[2];
    assert.ok(['before', 'after', '--restore', '--inspect'].includes(phase));
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json'),
    );
    const report = {
        scenes: {},
        captures: [],
        frames: {},
        nightPeaks: {},
        errors: [],
        restored: false,
    };
    const monitor = (page, role) => {
        page.on('pageerror', (error) => report.errors.push(role + ': ' + error.message));
        page.on('console', (message) => {
            if (message.type() === 'error')
                report.errors.push(role + ': ' + message.text().slice(0, 1000));
        });
    };
    let gm, player, backup;
    try {
        gm = await login(
            browser,
            accounts.find((account) => account.id === 1),
            options,
        );
        if (phase === '--restore') {
            await restore(gm, JSON.parse(fs.readFileSync(recoveryPath)));
            return;
        }
        const scenes = {};
        for (const id of [8, 9, 10]) {
            const scene = (scenes[id] = await snapshot(gm, id));
            report.scenes[id] = {
                size: [scene.width, scene.height],
                terrain: scene.terrain?.materials.map(({ name, type, variation }) => ({
                    name,
                    type,
                    variation,
                })),
                sources: scene.lighting.sources.length,
                vision: scene.vision?.enabled,
            };
        }
        if (phase === '--inspect') {
            console.log(JSON.stringify(report.scenes, null, 2));
            return;
        }
        assert.ok(!fs.existsSync(recoveryPath), 'Restore the previous QA run first.');
        backup = {
            active: (await api(gm, campaign)).activeSceneId,
            lighting: Object.fromEntries(
                Object.entries(scenes).map(([id, scene]) => [id, scene.lighting]),
            ),
        };
        fs.writeFileSync(recoveryPath, JSON.stringify(backup));
        player = await login(
            browser,
            accounts.find((account) => account.id === 2),
            options,
        );
        monitor(gm, 'GM');
        monitor(player, 'Player');
        const dir = out + '/' + phase;
        fs.mkdirSync(dir, { recursive: true });
        for (const [id, scene] of Object.entries(scenes)) {
            const hero = scene.tokens.find((token) => String(token.ownerUserId) === '2');
            const center = id === '10' ? [674, 544] : [scene.width / 2, scene.height / 2];
            const anchor = hero ?? { x: center[0], y: center[1] };
            const sources =
                scene.lighting.sources.length >= 2
                    ? scene.lighting.sources
                    : [
                          {
                              id: 'p2b-warm',
                              name: 'QA warm',
                              x: anchor.x,
                              y: anchor.y,
                              color: '#ffad64',
                          },
                          {
                              id: 'p2b-cool',
                              name: 'QA cool',
                              x: Math.min(scene.width, anchor.x + 160),
                              y: anchor.y,
                              color: '#78b5ff',
                          },
                      ].map((source) => ({
                          ...source,
                          enabled: true,
                          radius: 320,
                          intensity: 0.95,
                          falloff: 1,
                      }));
            await api(gm, campaign + '/activate', 'POST', { sceneId: Number(id) });
            for (const [profile, [brightness, color, local]] of Object.entries(profiles)) {
                await setLighting(gm, id, {
                    enabled: true,
                    mode: profile === 'day' ? 'day' : 'night',
                    brightness,
                    color,
                    sources: local ? sources : [],
                });
                await Promise.all([
                    gm.goto(base + campaign + '/scenes/' + id + '?mode=session'),
                    player.goto(base + campaign + '/play'),
                ]);
                await Promise.all([ready(gm), ready(player)]);
                const view = await snapshot(player, id);
                assert.equal(String(view.id), id);
                assert.equal(view.lighting.brightness, brightness);
                for (const zoom of [0.5, 1]) {
                    for (const [role, page] of [
                        ['gm', gm],
                        ['player', player],
                    ]) {
                        const key = [id, profile, role, zoom * 100].join('-');
                        const frames = await capture(page, dir, key, zoom, center, id === '10');
                        report.captures.push(key);
                        if (frames) report.frames[key] = frames;
                    }
                }
                assert.deepEqual(report.errors, []);
                if (brightness === 0) {
                    const peak = await lightPeak(gm);
                    report.nightPeaks[id + '-' + profile] = peak;
                    assert.ok(
                        local ? peak > 35 : peak === 0,
                        'Unexpected night lightmap peak: ' + peak,
                    );
                }
                console.log([phase, id, profile].join(' '));
            }
        }
        assert.deepEqual(report.errors, []);
    } finally {
        try {
            await player?.context().close();
            if (gm && backup) {
                await restore(gm, backup);
                report.restored = true;
            }
        } finally {
            await browser.close();
            if (['before', 'after'].includes(phase))
                fs.writeFileSync(out + '/' + phase + '.json', JSON.stringify(report, null, 2));
        }
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
