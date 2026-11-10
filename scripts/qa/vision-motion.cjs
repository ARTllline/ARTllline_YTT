/* eslint-disable @typescript-eslint/no-require-imports -- Reversible Chromium profiling on the permanent fixture. */
/* global require, process, console, window, performance, setTimeout, Buffer, URL */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, base } = require('./map07a.cjs');
const phase = process.argv[2] || 'before';
const out = 'artifacts/vision-motion/' + phase;
const withLighting = process.env.YTT_MOTION_LIGHTING === '1';
const withoutLighting = process.env.YTT_MOTION_LIGHTING === '0';
const brightness = Number(process.env.YTT_MOTION_BRIGHTNESS ?? 0.12);
const darkvisionFeet = Number(process.env.YTT_MOTION_DARKVISION_FEET ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (p) => api(p, '/scenes/7/snapshot');
const memory = (action) =>
    execFileSync('php', ['scripts/qa/fog-memory-fixture.php', action], { stdio: 'pipe' });
async function point(p, v) {
    return p.evaluate((v) => {
        const app = window.tabletopApp,
            a = app.stage.children[0].toGlobal(v),
            b = app.canvas.getBoundingClientRect();
        return { x: a.x + b.x, y: a.y + b.y };
    }, v);
}
async function click(p, v, double = false) {
    const a = await point(p, v);
    await p.mouse[double ? 'dblclick' : 'click'](a.x, a.y);
}
async function camera(p, zoom, anchor) {
    const canvas = tabletop(p),
        b = await canvas.boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    for (let i = 0; i < 6; i++) {
        const z = await p.evaluate(() => window.tabletopApp.stage.children[0].scale.x);
        if (Math.abs(z - zoom) < 0.001) break;
        await p.mouse.wheel(0, -Math.log(zoom / z) / 0.002);
        await sleep(260);
    }
    for (let i = 0; i < 10; i++) {
        const a = await point(p, anchor);
        const dx = Math.max(-400, Math.min(400, b.x + b.width / 2 - a.x));
        const dy = Math.max(-220, Math.min(220, b.y + b.height / 2 - a.y));
        if (Math.abs(dx) + Math.abs(dy) < 2) break;
        const start = { x: b.x + b.width / 2, y: b.y + 350 };
        await p.keyboard.down('Space');
        await p.mouse.move(start.x, start.y);
        await p.mouse.down();
        await p.mouse.move(start.x + dx, start.y + dy, { steps: 3 });
        await p.mouse.up();
        await p.keyboard.up('Space');
        await sleep(60);
    }
    await sleep(200);
}
async function instrument(p, tokenId) {
    await p.evaluate((id) => {
        const app = window.tabletopApp;
        const all = [];
        const walk = (v) => {
            all.push(v);
            for (const c of v.children ?? []) walk(c);
        };
        walk(app.stage);
        const layer = all.find((v) => v.currentMask),
            tokens = all.find((v) => v.views instanceof Map && v.tickMovement),
            lighting = all.find((v) => v.metrics && v.emitters instanceof Map);
        const profile = (window.motionProfile = {
            lightPasses: [],
            lightBefore: {},
            lightAfter: {},
            frames: [],
            sync: [],
            passes: [],
            stops: [],
            marks: [],
            allocations: 0,
            enabled: false,
        });
        window.__yttPerformance = (phase, detail) => {
            if (profile.enabled) profile.marks.push({ phase, ...detail });
        };
        for (const name of ['sync', 'finishMovements']) {
            const target = name === 'sync' ? layer : tokens,
                original = target[name].bind(target);
            target[name] = (...args) => {
                const t = performance.now(),
                    old = layer.memoryTexture;
                const result = original(...args);
                if (profile.enabled) {
                    if (name === 'sync') {
                        profile.sync.push(performance.now() - t);
                        if (old !== layer.memoryTexture) profile.allocations++;
                    } else profile.stops.push(performance.now());
                }
                return result;
            };
        }
        if (lighting) {
            const tick = lighting.tick.bind(lighting);
            lighting.tick = (...args) => {
                const before = lighting.metrics.passes,
                    t = performance.now();
                const result = tick(...args);
                if (profile.enabled && lighting.metrics.passes !== before)
                    profile.lightPasses.push(performance.now() - t);
                return result;
            };
            window.motionLighting = lighting;
        }
        const render = app.renderer.render.bind(app.renderer);
        app.renderer.render = (options) => {
            const t = performance.now();
            const r = render(options);
            if (
                profile.enabled &&
                [
                    layer.texture,
                    layer.currentSurface?.texture ?? layer.currentTexture,
                    layer.memoryTexture,
                ].includes(options?.target) &&
                options?.target
            )
                profile.passes.push({
                    ms: performance.now() - t,
                    w: options.target.width,
                    h: options.target.height,
                });
            return r;
        };
        app.ticker.add(
            () => {
                if (profile.enabled) {
                    const v = tokens.views.get(id);
                    const emitter =
                        lighting &&
                        [...lighting.emitters.values()].find(
                            (e) => e.active && e.model.tokenId === id,
                        );
                    const origin = emitter?.draw.uniforms.uniforms.uOrigin;
                    profile.frames.push({
                        t: performance.now(),
                        x: v?.x ?? 0,
                        y: v?.y ?? 0,
                        lx: origin?.[0],
                        ly: origin?.[1],
                        cx: v?.model.x ?? 0,
                        cy: v?.model.y ?? 0,
                        reveal: layer.composite?.uniforms.uniforms.uProgress,
                        moving: tokens.isMoving(id),
                    });
                }
            },
            undefined,
            -60,
        );
    }, tokenId);
}
async function start(p) {
    await p.evaluate(() => {
        const p = window.motionProfile;
        for (const k of ['frames', 'sync', 'passes', 'stops', 'marks']) p[k] = [];
        p.allocations = 0;
        p.lightPasses = [];
        p.lightBefore = { ...window.motionLighting?.metrics };
        p.enabled = true;
    });
}
async function finish(p) {
    return p.evaluate(() => {
        window.motionProfile.enabled = false;
        window.motionProfile.lightAfter = { ...window.motionLighting?.metrics };
        return window.motionProfile;
    });
}
function stats(a) {
    if (!a.length) return { n: 0 };
    a = [...a].sort((a, b) => a - b);
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    return {
        n: a.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: a.at(-1),
        sum: a.reduce((s, x) => s + x, 0),
    };
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
        phase,
        cases: [],
        errors: [],
        environment: {
            browser: browser.version(),
            viewport: '1680x1050',
            scene: 7,
            players: 2,
            headless: true,
            capture: process.env.YTT_MOTION_CAPTURE === '1',
            lighting: withLighting,
            brightness: withLighting ? brightness : null,
            darkvisionFeet,
        },
    };
    let pages,
        gm,
        baseline,
        campaign,
        darkvisionCharacter,
        backed = false;
    const requests = [];
    const auxiliary = [];
    try {
        memory('backup');
        backed = true;
        pages = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    browser,
                    accounts.find((a) => a.id === id),
                ),
            ),
        );
        [gm] = pages;
        const [, p1] = pages;
        for (const [i, p] of pages.entries()) {
            await p.context().setExtraHTTPHeaders({ 'X-YTT-Perf': '1' });
            p.on('pageerror', (e) =>
                report.errors.push({ role: i, message: e.message, stack: e.stack }),
            );
            await p.context().addInitScript(() => {
                window.__yttPerformance = (phase, detail) => {
                    const p = window.motionProfile;
                    if (p?.enabled) p.marks.push({ phase, ...detail });
                };
            });
            p.on('response', async (r) => {
                const isMovement = /\/(control\/step|move)$/.test(r.url());
                if (isMovement || /\/(session-log|preload|lighting)(?:\?|$)/.test(r.url())) {
                    await r.finished();
                    const rq = r.request();
                    const h = await r.allHeaders();
                    (isMovement ? requests : auxiliary).push({
                        path: new URL(r.url()).pathname,
                        role: i,
                        status: r.status(),
                        timing: rq.timing(),
                        server: h['server-timing'],
                        id: h['x-ytt-request-id'],
                    });
                }
            });
        }
        baseline = await state(gm);
        campaign = await api(gm, '/campaigns/5');
        fs.writeFileSync(out + '/restore.private.json', JSON.stringify({ baseline, campaign }));
        const hero = baseline.tokens.find((t) => t.ownerUserId === '2');
        await api(gm, '/campaigns/5/activate', 'POST', { sceneId: 7 });
        await api(gm, '/scenes/7/grid', 'PUT', { ...baseline.grid, snap: false });
        if (darkvisionFeet) {
            const observer = baseline.tokens.find((t) => t.ownerUserId === '8');
            darkvisionCharacter = baseline.characters.find((c) => c.id === observer.characterId);
            await api(gm, '/campaigns/5/characters', 'POST', {
                id: darkvisionCharacter.id,
                name: darkvisionCharacter.name,
                rules: {
                    ...(darkvisionCharacter.rules ?? darkvisionCharacter.rulesSuggestion),
                    senses: { darkvision_ft: darkvisionFeet },
                },
            });
        }
        if (withLighting) {
            const source = (id, x, color, tokenId = null) => ({
                id,
                name: id,
                enabled: true,
                x,
                y: 1250,
                tokenId,
                radius: 380,
                color,
                intensity: 1.2,
                falloff: 1,
            });
            await api(gm, '/scenes/7/lighting', 'PUT', {
                expected: baseline.lighting,
                value: {
                    enabled: true,
                    mode: 'night',
                    brightness,
                    color: '#829bd4',
                    sources: [
                        source('moving', 2300, '#ffc078', hero.id),
                        source('torch-a', 2350, '#ffc078'),
                        source('torch-b', 2600, '#8fbaff'),
                        source('torch-c', 2850, '#ffc078'),
                        source('torch-d', 3100, '#a5e5bf'),
                    ],
                },
            });
        }
        if (withoutLighting) {
            await api(gm, '/scenes/7/lighting', 'PUT', {
                expected: baseline.lighting,
                value: { ...baseline.lighting, enabled: false },
            });
        }
        for (const mode of process.env.YTT_MOTION_MODES?.split(',') ?? ['none', 'vision', 'fog']) {
            await Promise.all(
                pages.map((p) =>
                    p.context().setExtraHTTPHeaders({
                        'X-YTT-Perf': '1',
                        'X-YTT-Perf-Exploration': mode === 'vision' ? '0' : '1',
                    }),
                ),
            );
            await api(gm, '/scenes/7/vision', 'POST', {
                enabled: mode !== 'none',
                observerId: hero.id,
                range: 600,
            });
            await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2300, y: 1250, size: 30, scale: 1 });
            await Promise.all(
                pages.map((p, i) =>
                    p.goto(base + (i ? '/campaigns/5/play' : '/campaigns/5/scenes/7?mode=session')),
                ),
            );
            await Promise.all(pages.map((p) => tabletop(p).waitFor({ timeout: 60000 })));
            report.environment.renderer ??= await p1.evaluate(() => {
                const gl = window.tabletopApp.renderer.gl;
                const info = gl?.getExtension('WEBGL_debug_renderer_info');
                return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'WebGL';
            });
            await Promise.all(
                pages.map((p) => p.locator('.scene-title-arrival').waitFor({ state: 'hidden' })),
            );
            await sleep(600);
            for (const [i, p] of pages.entries())
                await instrument(
                    p,
                    i === 2 ? baseline.tokens.find((t) => t.ownerUserId === '8').id : hero.id,
                );
            for (const z of process.env.YTT_MOTION_ZOOMS?.split(',').map(Number) ?? [0.29, 0.5, 1])
                for (const input of process.env.YTT_MOTION_INPUTS?.split(',') ?? [
                    'wasd',
                    'click',
                ]) {
                    await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2300, y: 1250 });
                    await sleep(450);
                    for (const p of pages) await camera(p, z, { x: 2650, y: 1250 });
                    await p1.bringToFront();
                    await click(p1, { x: 2300, y: 1250 });
                    if (input === 'wasd')
                        await p1
                            .getByRole('button', { name: 'Управлять · WASD', exact: true })
                            .click();
                    requests.length = 0;
                    auxiliary.length = 0;
                    await Promise.all(pages.map(start));
                    const captures = [],
                        captureTimes = [];
                    if (process.env.YTT_MOTION_CAPTURE === '1') {
                        for (const [i, p] of pages.entries()) {
                            const cdp = await p.context().newCDPSession(p);
                            let frame = 0;
                            cdp.on('Page.screencastFrame', (e) => {
                                captureTimes.push({ role: i, frame, at: e.metadata.timestamp });
                                fs.writeFileSync(
                                    out +
                                        '/' +
                                        mode +
                                        '-' +
                                        input +
                                        '-' +
                                        Math.round(z * 100) +
                                        '-role' +
                                        i +
                                        '-frame' +
                                        String(frame++).padStart(4, '0') +
                                        '.jpg',
                                    Buffer.from(e.data, 'base64'),
                                );
                                void cdp.send('Page.screencastFrameAck', {
                                    sessionId: e.sessionId,
                                });
                            });
                            await cdp.send('Page.startScreencast', {
                                format: 'jpeg',
                                quality: 70,
                                maxWidth: 1260,
                                maxHeight: 788,
                                everyNthFrame: 8,
                            });
                            captures.push(cdp);
                        }
                    }
                    if (input === 'wasd') {
                        await p1.keyboard.down('d');
                        await sleep(Number(process.env.YTT_MOTION_HOLD_MS ?? 2600));
                        await p1.keyboard.up('d');
                        await sleep(550);
                    } else {
                        await click(p1, { x: 3100, y: 1250 }, true);
                        await sleep(3100);
                    }
                    // Frame captures are outside measured window except the middle one, marked separately.
                    const samples = await Promise.all(pages.map(finish));
                    for (const cdp of captures) {
                        await cdp.send('Page.stopScreencast');
                        await cdp.detach();
                    }
                    if (captures.length)
                        fs.writeFileSync(
                            out + '/' + mode + '-' + input + '-timestamps.json',
                            JSON.stringify(captureTimes),
                        );
                    let completed;
                    if (input === 'click' && !phase.startsWith('before')) {
                        await p1.waitForFunction(
                            (id) => {
                                const find = (v) =>
                                    v.model?.id === id && v.badges
                                        ? v
                                        : (v.children ?? []).map(find).find(Boolean);
                                const v = find(window.tabletopApp.stage);
                                return v && v.x > 3097 && Math.abs(v.y - 1250) < 3;
                            },
                            hero.id,
                            { timeout: 10000 },
                        );
                        completed = true;
                    }
                    await p1.screenshot({
                        path: out + '/' + mode + '-' + input + '-' + Math.round(z * 100) + '.png',
                    });
                    const result = {
                        mode,
                        input,
                        zoom: z,
                        completed,
                        requests: [...requests],
                        auxiliary: [...auxiliary],
                        roles: samples.map((s, i) => {
                            fs.writeFileSync(
                                out +
                                    '/' +
                                    mode +
                                    '-' +
                                    input +
                                    '-' +
                                    Math.round(z * 100) +
                                    '-role' +
                                    i +
                                    '-frames.json',
                                JSON.stringify(s),
                            );
                            const dt = s.frames.slice(1).map((f, i) => f.t - s.frames[i].t);
                            return {
                                role: i,
                                fps: dt.length / (dt.reduce((a, b) => a + b, 0) / 1000),
                                frameMs: stats(dt),
                                maskSyncMs: stats(s.sync),
                                lightingPassMs: stats(s.lightPasses),
                                lightingPasses:
                                    (s.lightAfter.passes ?? 0) - (s.lightBefore.passes ?? 0),
                                lightingAllocations:
                                    (s.lightAfter.allocations ?? 0) -
                                    (s.lightBefore.allocations ?? 0),
                                lightingUploads:
                                    (s.lightAfter.maskUploads ?? 0) -
                                    (s.lightBefore.maskUploads ?? 0),
                                maskPassMs: stats(s.passes.map((p) => p.ms)),
                                maskPasses: s.passes.length,
                                allocations: s.allocations,
                                movementResets: s.stops.length,
                                distance: s.frames.length
                                    ? Math.hypot(
                                          s.frames.at(-1).x - s.frames[0].x,
                                          s.frames.at(-1).y - s.frames[0].y,
                                      )
                                    : 0,
                                maxTokenStep: Math.max(
                                    0,
                                    ...s.frames
                                        .slice(1)
                                        .map((f, i) =>
                                            Math.hypot(f.x - s.frames[i].x, f.y - s.frames[i].y),
                                        ),
                                ),
                            };
                        }),
                    };
                    report.cases.push(result);
                    if (!phase.startsWith('before')) {
                        assert.deepEqual(report.errors, []);
                        assert.ok(result.requests.every((r) => r.status === 200));
                        if (input === 'wasd') {
                            assert.ok(
                                result.requests.length >= 5 && result.roles[1].distance > 200,
                            );
                            assert.ok(
                                await p1
                                    .getByRole('button', { name: 'Выйти · Esc', exact: true })
                                    .isVisible(),
                            );
                        }
                    }
                    console.log(
                        JSON.stringify({
                            mode,
                            input,
                            zoom: z,
                            requests: result.requests.length,
                            player: result.roles[1],
                        }),
                    );
                    if (input === 'wasd') await p1.keyboard.press('Escape');
                    await sleep(450);
                    fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
                }
        }
    } catch (error) {
        report.failure = error.message;
        throw error;
    } finally {
        try {
            if (gm && baseline) {
                await Promise.all(
                    pages.map((p) => p.context().setExtraHTTPHeaders({ 'X-YTT-Perf': '1' })),
                );
                if (withLighting || withoutLighting)
                    await api(gm, '/scenes/7/lighting', 'PUT', {
                        expected: (await state(gm)).lighting,
                        value: baseline.lighting,
                    });
                if (darkvisionCharacter) {
                    await api(gm, '/campaigns/5/characters', 'POST', {
                        id: darkvisionCharacter.id,
                        name: darkvisionCharacter.name,
                        rules: darkvisionCharacter.rules ?? null,
                    });
                }
                const hero = baseline.tokens.find((t) => t.ownerUserId === '2');
                await api(gm, '/tokens/' + hero.id, 'PATCH', {
                    x: hero.x,
                    y: hero.y,
                    size: hero.size,
                    scale: hero.scale,
                    vision_range: hero.visionRange,
                });
                await api(gm, '/scenes/7/vision', 'POST', {
                    enabled: baseline.vision.enabled,
                    memoryPolicy: baseline.vision.memoryPolicy,
                });
                await api(gm, '/scenes/7/grid', 'PUT', baseline.grid);
                await api(gm, '/campaigns/5/activate', 'POST', { sceneId: campaign.activeSceneId });
                const restored = await state(gm);
                assert.deepEqual(restored.tokens, baseline.tokens);
                assert.deepEqual(restored.vision, baseline.vision);
                assert.deepEqual(restored.grid, baseline.grid);
                if (withLighting || withoutLighting) assert.deepEqual(restored.lighting, baseline.lighting);
                if (darkvisionCharacter)
                    assert.deepEqual(
                        restored.characters.find((c) => c.id === darkvisionCharacter.id).rules,
                        darkvisionCharacter.rules,
                    );
                report.restored = true;
            }
        } finally {
            try {
                if (backed) memory('restore');
                if (report.restored && (withLighting || withoutLighting || phase === 'map10a-control-clean'))
                    fs.rmSync(out + '/restore.private.json', { force: true });
                fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
            } finally {
                await browser.close();
            }
        }
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
