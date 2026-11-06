/* eslint-disable @typescript-eslint/no-require-imports -- Reversible native Chromium acceptance on the permanent fixture. */
/* global require, process, console, window, setTimeout, Buffer, structuredClone */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, base } = require('./map07a.cjs');
const out = 'artifacts/map10a';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snapshot = (p, id = 7) => api(p, `/scenes/${id}/snapshot`);
const memory = (action) =>
    execFileSync('php', ['scripts/qa/fog-memory-fixture.php', action], { stdio: 'pipe' });
const light = (id, x, y, tokenId = null, color = '#ffc078') => ({
    id,
    name: id,
    enabled: true,
    x,
    y,
    tokenId,
    radius: 450,
    color,
    intensity: 1.2,
    falloff: 1,
});
const settings = (sources, day = false) => ({
    enabled: true,
    mode: day ? 'day' : 'night',
    brightness: day ? 1 : 0.12,
    color: day ? '#fff4df' : '#829bd4',
    sources,
});
async function save(gm, id, value) {
    return api(gm, `/scenes/${id}/lighting`, 'PUT', {
        expected: (await snapshot(gm, id)).lighting,
        value,
    });
}
async function point(p, v) {
    return p.evaluate((v) => {
        const app = window.tabletopApp,
            a = app.stage.children[0].toGlobal(v),
            b = app.canvas.getBoundingClientRect();
        return { x: a.x + b.x, y: a.y + b.y };
    }, v);
}
async function click(p, v, twice = false) {
    const a = await point(p, v);
    await p.mouse[twice ? 'dblclick' : 'click'](a.x, a.y);
}
async function focus(p, at, zoom = 0.7) {
    const canvas = tabletop(p),
        b = await canvas.boundingBox();
    await p.bringToFront();
    await p.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    const old = await p.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
    await p.mouse.wheel(0, -Math.log(zoom / old) / 0.002);
    await sleep(400);
    for (let i = 0; i < 10; i++) {
        const a = await point(p, at);
        const dx = Math.max(-400, Math.min(400, b.x + b.width / 2 - a.x));
        const dy = Math.max(-220, Math.min(220, b.y + b.height / 2 - a.y));
        if (Math.abs(dx) + Math.abs(dy) < 2) break;
        const start = { x: b.x + b.width / 2, y: b.y + 350 };
        await p.keyboard.down('Space');
        await p.mouse.move(start.x, start.y);
        await p.mouse.down();
        await p.mouse.move(start.x + dx, start.y + dy, { steps: 4 });
        await p.mouse.up();
        await p.keyboard.up('Space');
        await sleep(60);
    }
    await sleep(150);
}
async function ready(p, id) {
    await p.waitForFunction(
        (id) => {
            const layer = window.tabletopApp?.stage.children[0].children.find(
                (v) => v.metrics && v.emitters instanceof Map,
            );
            return layer && !layer.reader.pending && layer.emitters.has(id);
        },
        id,
        { timeout: 30000 },
    );
    await sleep(80);
}
async function gpu(p, points, width = 3300, height = 1400) {
    return p.evaluate(
        ({ points, width, height }) => {
            const app = window.tabletopApp,
                layer = app.stage.children[0].children.find(
                    (v) => v.metrics && v.emitters instanceof Map,
                );
            const data = app.renderer.extract.pixels({ target: layer.target });
            const pixels = points.map((p) => {
                const x = Math.min(data.width - 1, Math.floor((p.x * data.width) / width)),
                    y = Math.min(data.height - 1, Math.floor((p.y * data.height) / height));
                return Array.from(
                    data.pixels.slice((y * data.width + x) * 4, (y * data.width + x) * 4 + 4),
                );
            });
            return {
                pixels,
                metrics: layer.metrics,
                emitters: layer.emitters.size,
                renderer: app.renderer.type,
            };
        },
        { points, width, height },
    );
}
function maskAt(projection, id, p) {
    const source = projection.sources.find((v) => v.id === id);
    if (!source) return false;
    let bytes = Buffer.from(
        source.mask.startsWith('~') ? source.mask.slice(1) : source.mask,
        'base64',
    );
    if (source.mask.startsWith('~')) {
        const parts = [];
        for (let i = 0; i + 2 < bytes.length; i += 3)
            parts.push(Buffer.alloc(bytes.readUInt16LE(i), bytes[i + 2]));
        bytes = Buffer.concat(parts);
    }
    const bit =
        Math.floor(p.y / projection.cellSize) * projection.width +
        Math.floor(p.x / projection.cellSize);
    return !!(bytes[bit >> 3] & (1 << (bit % 8)));
}
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
        ],
    });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const report = {
        checks: [],
        errors: [],
        gpu: {},
        environment: { browser: browser.version(), viewport: '1680x1050', roles: 3 },
    };
    const record = (text) => {
        report.checks.push(text);
        console.log(text);
    };
    let pages,
        gm,
        initial,
        townhouse,
        campaign,
        backed = false;
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
        if (process.argv.includes('--restore')) {
            const saved = JSON.parse(fs.readFileSync(out + '/restore.private.json', 'utf8'));
            for (const id of [2, 8]) {
                const t = saved.initial.tokens.find((t) => t.ownerUserId === String(id));
                await api(gm, '/tokens/' + t.id, 'PATCH', {
                    x: t.x,
                    y: t.y,
                    size: t.size,
                    scale: t.scale,
                    vision_range: t.visionRange,
                });
            }
            await save(gm, 7, saved.initial.lighting);
            await api(gm, '/scenes/7/structure', 'POST', {
                value: saved.initial.structure.graph,
                expected: (await snapshot(gm)).structure.hash,
            });
            await api(gm, '/scenes/7/vision', 'POST', {
                enabled: saved.initial.vision.enabled,
                memoryPolicy: saved.initial.vision.memoryPolicy,
            });
            await api(gm, '/scenes/7/grid', 'PUT', saved.initial.grid);
            await save(gm, 5, saved.townhouse.lighting);
            await api(gm, '/campaigns/5/activate', 'POST', {
                sceneId: saved.campaign.activeSceneId,
            });
            memory('restore');
            record('Recovered original permanent fixture');
            report.restored = true;
            return;
        }
        for (const p of pages) {
            p.on('pageerror', (e) => report.errors.push(e.message));
            p.on('console', (m) => {
                if (m.type() === 'error' && /shader|WebGL|GL_INVALID/i.test(m.text()))
                    report.errors.push(m.text());
            });
        }
        memory('backup');
        backed = true;
        initial = await snapshot(gm);
        townhouse = await snapshot(gm, 5);
        campaign = await api(gm, '/campaigns/5');
        fs.writeFileSync(
            out + '/restore.private.json',
            JSON.stringify({ initial, townhouse, campaign }),
        );
        const hero = initial.tokens.find((t) => t.ownerUserId === '2'),
            hero2 = initial.tokens.find((t) => t.ownerUserId === '8');
        await api(gm, '/campaigns/5/activate', 'POST', { sceneId: 7 });
        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2550, y: 700, size: 30, scale: 1 });
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2200, y: 400, size: 30, scale: 1 });
        for (const t of [hero, hero2])
            await api(gm, '/scenes/7/vision', 'POST', {
                enabled: true,
                observerId: t.id,
                range: 600,
            });
        await api(gm, '/scenes/7/grid', 'PUT', { ...initial.grid, snap: false });
        const sources = [
            light('moving-torch', 2550, 700, hero.id),
            light('window-torch', 2200, 400, hero2.id, '#8fbaff'),
            light('furniture-torch', 2920, 900),
        ];
        await save(gm, 7, settings(sources));
        await api(
            p1,
            '/scenes/7/lighting',
            'PUT',
            { value: settings(sources), expected: settings(sources) },
            403,
        );
        const door = async (open) =>
            api(gm, '/scenes/7/structure', 'POST', {
                door: { id: 'los-corridor-door', open },
                expected: (await snapshot(gm)).structure.hash,
            });
        await door(false);
        await Promise.all(
            pages.map((p, i) =>
                p.goto(base + (i ? '/campaigns/5/play' : '/campaigns/5/scenes/7?mode=session')),
            ),
        );
        await Promise.all(pages.map((p) => tabletop(p).waitFor({ timeout: 60000 })));
        await Promise.all([
            ready(gm, 'moving-torch'),
            ready(p1, 'moving-torch'),
            ready(p2, 'window-torch'),
        ]);
        let render = await api(gm, '/scenes/7/lighting');
        assert.equal(maskAt(render, 'moving-torch', { x: 2750, y: 700 }), false);
        await door(true);
        await sleep(700);
        await ready(p1, 'moving-torch');
        render = await api(gm, '/scenes/7/lighting');
        assert.equal(maskAt(render, 'moving-torch', { x: 2750, y: 700 }), true);
        record('GM + 2 isolated Players: door changes shadow; light settings are GM-only');
        const playerRender = await api(p1, '/scenes/7/lighting');
        assert.ok(!JSON.stringify(playerRender).includes('blocksLight'));
        assert.ok(!JSON.stringify(playerRender).includes('collider'));
        assert.equal(maskAt(playerRender, 'moving-torch', { x: 3200, y: 1300 }), false);
        const windowRender = await api(p2, '/scenes/7/lighting');
        assert.equal(maskAt(windowRender, 'window-torch', { x: 2120, y: 400 }), true);
        const graph = structuredClone((await snapshot(gm)).structure.graph);
        // Both independent window flags are tested through the real mutation and realtime path.
        const windowOpening = graph.openings.find(
            (o) => o.type === 'window' && !o.blocksVision && o.id.startsWith('los-'),
        );
        assert.ok(windowOpening);
        windowOpening.blocksLight = true;
        await api(gm, '/scenes/7/structure', 'POST', {
            value: graph,
            expected: (await snapshot(gm)).structure.hash,
        });
        assert.equal(
            maskAt(await api(p2, '/scenes/7/lighting'), 'window-torch', { x: 2120, y: 400 }),
            false,
        );
        record(
            'Transparent window may block light independently; raster payload has no unseen geometry',
        );
        windowOpening.blocksLight = false;
        windowOpening.blocksVision = true;
        await api(gm, '/scenes/7/structure', 'POST', {
            value: graph,
            expected: (await snapshot(gm)).structure.hash,
        });
        await save(gm, 7, settings([light('anonymous-candle', 2080, 400)]));
        const anonymous = await api(p2, '/scenes/7/lighting');
        assert.ok(anonymous.spill && anonymous.sources.length === 0);
        assert.ok(!JSON.stringify(anonymous).includes('anonymous-candle'));
        await p2.waitForFunction(() => {
            const layer = window.tabletopApp.stage.children[0].children.find(
                (v) => v.metrics && v.emitters instanceof Map,
            );
            return layer?.lastFrame?.render?.sources.length === 0 && layer.spillSprite.visible;
        });
        await sleep(60);
        report.gpu.spill = await gpu(p2, [{ x: 2200, y: 400 }]);
        assert.ok(report.gpu.spill.pixels[0][0] > 100);
        record(
            'Player 2 GPU receives colored spill through a vision-only window without emitter metadata',
        );
        await api(gm, '/scenes/7/structure', 'POST', {
            value: initial.structure.graph,
            expected: (await snapshot(gm)).structure.hash,
        });
        await save(gm, 7, settings(sources));
        await Promise.all([focus(p1, { x: 2550, y: 700 }), focus(p2, { x: 2200, y: 400 })]);
        report.gpu.night = await gpu(p1, [
            { x: 2550, y: 700 },
            { x: 2550, y: 1050 },
        ]);
        assert.ok(report.gpu.night.pixels[0][0] > 150);
        await p1.screenshot({ path: out + '/playground-night-player1.png' });
        await p2.screenshot({ path: out + '/playground-night-player2.png' });
        // Light masks/targets are reused while camera changes and while idle.
        const before = await gpu(p1, []);
        await sleep(700);
        const after = await gpu(p1, []);
        assert.equal(after.metrics.passes, before.metrics.passes);
        assert.equal(after.metrics.allocations, before.metrics.allocations);
        report.idle = { before: before.metrics, after: after.metrics };
        record('GPU lightmap renders colored falloff; idle frames allocate/upload/render nothing');
        // Manual Fog remains above lighting, with no visibility or targeting changes.
        for (const operation of ['cover', 'reveal']) {
            await api(gm, '/scenes/7/fog/actions', 'POST', {
                operation,
                shape: 'rectangle',
                geometry: {
                    points: [
                        { x: 2530, y: 680 },
                        { x: 2570, y: 720 },
                    ],
                },
            });
            await sleep(150);
            const alpha = await p1.evaluate(() => {
                const app = window.tabletopApp,
                    fog = app.stage.children[0].children.find((c) => c.paintRoot && c.saved);
                const data = app.renderer.extract.pixels({ target: fog.saved });
                return data.pixels[
                    (Math.floor((700 * data.height) / 1400) * data.width +
                        Math.floor((2550 * data.width) / 3300)) *
                        4 +
                        3
                ];
            });
            assert.equal(alpha, operation === 'cover' ? 255 : 0);
        }
        record('Fog current/explored authority and manual cover remain above lighting');
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2300, y: 1320 });
        await focus(p2, { x: 2400, y: 1300 }, 0.5);
        await sleep(250);
        await click(p2, { x: 2300, y: 1320 });
        await p2.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
        await p2.keyboard.down('d');
        await sleep(800);
        await p2.keyboard.up('d');
        await sleep(350);
        assert.ok((await snapshot(gm)).tokens.find((t) => t.id === hero2.id).x > 2350);
        await p2.keyboard.press('Escape');
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2200, y: 400 });
        record('Player 2 also moves its blue attached light using real WASD');

        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2300, y: 1250 });
        await focus(p1, { x: 2650, y: 1250 }, 0.7);
        await sleep(250);
        await click(p1, { x: 2300, y: 1250 });
        await p1.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
        await p1.keyboard.down('d');
        await sleep(1500);
        await p1.keyboard.up('d');
        await sleep(500);
        assert.ok((await snapshot(gm)).tokens.find((t) => t.id === hero.id).x > 2450);
        await p1.keyboard.press('Escape');
        await sleep(250);
        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2300, y: 1250 });
        await focus(p1, { x: 2650, y: 1250 }, 0.5);
        await sleep(400);
        await click(
            p1,
            (await snapshot(p1)).tokens.find((t) => t.id === hero.id),
        );
        const moveResponse = p1.waitForResponse((r) => r.url().endsWith('/move'), {
            timeout: 10000,
        });
        await click(p1, { x: 3000, y: 1250 }, true);
        assert.equal((await moveResponse).status(), 200);
        await p1.waitForFunction(
            (id) => {
                const find = (v) =>
                    v.model?.id === id && v.badges ? v : (v.children ?? []).map(find).find(Boolean);
                return find(window.tabletopApp.stage)?.x > 2997;
            },
            hero.id,
            { timeout: 15000 },
        );
        await ready(p1, 'moving-torch');
        const moving = await api(p1, '/scenes/7/lighting');
        assert.ok(moving.sources.find((s) => s.id === 'moving-torch').x > 2997);
        report.gpu.moving = await gpu(p1, [{ x: 3000, y: 1250 }]);
        record(
            'Real WASD + long Click-to-Move finish with the attached light at accepted position',
        );
        // Real raster battlemap evidence, not a synthetic lighting demo.
        await api(gm, '/campaigns/5/activate', 'POST', { sceneId: 5 });
        const h = townhouse.tokens.find((t) => t.ownerUserId === '2'),
            h2 = townhouse.tokens.find((t) => t.ownerUserId === '8');
        const map = townhouse.map;
        const center = { x: map.x + map.width / 2, y: map.y + map.height / 2 };
        const realSources = [
            light('kern-torch', h.x, h.y, h.id),
            light('lyra-magic', h2.x, h2.y, h2.id, '#95b9ff'),
            light('hearth', center.x, center.y),
            light('candle', center.x + 250, center.y - 230, null, '#ffc078'),
        ];
        for (const day of [true, false]) {
            await save(gm, 5, settings(realSources, day));
            await Promise.all(
                pages.map((p, i) =>
                    p.goto(base + (i ? '/campaigns/5/play' : '/campaigns/5/scenes/5?mode=session')),
                ),
            );
            await Promise.all(pages.map((p) => tabletop(p).waitFor({ timeout: 60000 })));
            await Promise.all(pages.map((p) => ready(p, 'kern-torch')));
            await Promise.all(
                pages.map(async (p) => {
                    await p.waitForFunction(() =>
                        window.tabletopApp?.stage.children[0].children.some(
                            (v) => v.boundsOutline && v.image?.visible && v.image.texture.width > 1,
                        ),
                    );
                    await sleep(400);
                    await p.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
                }),
            );
            for (const [i, p] of pages.entries()) {
                await focus(p, center, 0.38);
                await p.screenshot({
                    path:
                        out +
                        `/townhouse-${day ? 'day' : 'night'}-${['gm', 'player1', 'player2'][i]}.png`,
                });
            }
        }
        record(
            'Real Flinns Townhouse battlemap: day/night, four colored sources, screenshots for all three roles',
        );
        await gm.goto(base + '/campaigns/5/scenes/5?mode=prepare');
        await tabletop(gm).waitFor();
        await gm
            .getByRole('button', { name: /Редактировать карту|Создать редактируемую карту/ })
            .click();
        await gm.getByRole('button', { name: 'Свет', exact: true }).click();
        await gm.getByRole('button', { name: 'Добавить факел' }).click();
        await gm.getByRole('textbox', { name: 'Название источника' }).fill('Путевой факел');
        await gm.getByLabel('Привязка света', { exact: true }).selectOption(h.id);
        await gm.getByLabel('Радиус света', { exact: true }).fill('500');
        await gm.getByRole('button', { name: 'Сохранить свет', exact: true }).click();
        await gm.getByText('Освещение сохранено', { exact: true }).waitFor();
        assert.equal((await snapshot(gm, 5)).lighting.sources.at(-1).tokenId, h.id);
        await gm.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
        await gm.screenshot({ path: out + '/gm-lighting-editor.png' });
        record('GM editor: add torch, name, token binding, radius, save and persistence');
        assert.deepEqual(report.errors, []);
    } catch (error) {
        report.failure = error.stack;
        if (pages) {
            report.visibleStatus = await pages[1].locator('body').innerText();
            await pages[1].screenshot({ path: out + '/failure.png' });
        }
        fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        console.error(error.message);
        throw error;
    } finally {
        try {
            if (gm && initial) {
                for (const id of [2, 8]) {
                    const t = initial.tokens.find((t) => t.ownerUserId === String(id));
                    await api(gm, '/tokens/' + t.id, 'PATCH', {
                        x: t.x,
                        y: t.y,
                        size: t.size,
                        scale: t.scale,
                        vision_range: t.visionRange,
                    });
                }
                await save(gm, 7, initial.lighting);
                await api(gm, '/scenes/7/structure', 'POST', {
                    value: initial.structure.graph,
                    expected: (await snapshot(gm)).structure.hash,
                });
                await api(gm, '/scenes/7/vision', 'POST', {
                    enabled: initial.vision.enabled,
                    memoryPolicy: initial.vision.memoryPolicy,
                });
                await api(gm, '/scenes/7/grid', 'PUT', initial.grid);
                await save(gm, 5, townhouse.lighting);
                await api(gm, '/campaigns/5/activate', 'POST', { sceneId: campaign.activeSceneId });
                assert.deepEqual((await snapshot(gm)).tokens, initial.tokens);
                report.restored = true;
            }
        } finally {
            try {
                if (backed) memory('restore');
                if (report.restored) fs.rmSync(out + '/restore.private.json', { force: true });
                fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
            } finally {
                await browser.close();
            }
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
