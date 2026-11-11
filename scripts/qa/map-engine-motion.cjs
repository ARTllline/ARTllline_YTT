/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, window, document, performance, setTimeout, clearTimeout, URL */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, base, tabletop } = require('./map07a.cjs');
const { instrument, begin, end, stats } = require('./map-engine-performance.cjs');
const phase = process.argv[2] ?? 'before';
const out = `artifacts/map-engine-performance/${phase}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backup = 'artifacts/map-engine-performance/motion-restore.private.json';
const memory = (action) =>
    execFileSync('php', ['scripts/qa/fog-memory-fixture.php', action, '10'], { stdio: 'pipe' });
const addedRtt = Number(process.env.YTT_PERF_RTT ?? 0);
async function main() {
    fs.mkdirSync(out, { recursive: true });
    assert.ok(!fs.existsSync('public/hot'), 'Production build required');
    const browser = await chromium.launch({
        channel: 'chrome',
        headless: true,
        args: [
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--enable-precise-memory-info',
        ],
    });
    const report = {
        phase,
        scene: 10,
        build: JSON.parse(fs.readFileSync('public/build/manifest.json'))['resources/js/app.tsx']
            .file,
        browser: browser.version(),
        addedRtt,
        cases: [],
        requests: [],
        errors: [],
        restored: false,
    };
    let gm,
        saved,
        backed = false;
    const echoTimers = new Set();
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
        );
        if (process.argv.includes('--restore')) {
            saved = JSON.parse(fs.readFileSync(backup));
            backed = true;
            return;
        }
        assert.ok(!fs.existsSync(backup), 'Restore interrupted run first');
        memory('backup');
        backed = true;
        saved = {
            scene: await api(gm, '/scenes/10/snapshot'),
            active: (await api(gm, '/campaigns/5')).activeSceneId,
        };
        fs.writeFileSync(backup, JSON.stringify(saved));
        const hero = saved.scene.tokens.find((t) => t.ownerUserId === '2');
        report.fixture = {
            props: saved.scene.props.length,
            tokens: saved.scene.tokens.length,
            vision: saved.scene.vision.enabled,
            lighting: saved.scene.lighting,
            hero: { id: hero.id, x: hero.x, y: hero.y, size: hero.size },
        };
        await api(gm, '/campaigns/5/activate', 'POST', { sceneId: 10 });
        await api(gm, '/scenes/10/grid', 'PUT', { ...saved.scene.grid, snap: false });
        const p1 = await login(
            browser,
            accounts.find((a) => a.id === 2),
        );
        const pages =
            process.env.YTT_PERF_SINGLE === '1'
                ? [p1]
                : process.env.YTT_PERF_TWO === '1'
                  ? [gm, p1]
                  : [
                        gm,
                        p1,
                        await login(
                            browser,
                            accounts.find((a) => a.id === 8),
                        ),
                    ];
        await p1.addInitScript((delay) => {
            for (const type of ['keydown', 'keyup', 'pointerup'])
                window.addEventListener(
                    type,
                    (e) => {
                        const p = window.engineProfile;
                        if (p?.active) p.events.push({ type, code: e.code, t: performance.now() });
                    },
                    { capture: true },
                );
            const native = window.fetch;
            window.fetch = async (...args) => {
                if (!/\/api\/tokens\/\d+\/(control\/(start|step)|move)$/.test(String(args[0])))
                    return native(...args);
                const began = performance.now();
                await new Promise((r) => setTimeout(r, delay / 2));
                if (window.motionRejectNext && String(args[0]).endsWith('/step')) {
                    window.motionRejectNext = false;
                    const body = JSON.parse(args[1].body);
                    body.sequence += 10;
                    args[1] = { ...args[1], body: JSON.stringify(body) };
                }
                const result = await native(...args);
                await new Promise((r) => setTimeout(r, delay / 2));
                (window.motionRequests ??= []).push({
                    url: String(args[0]),
                    began,
                    elapsed: performance.now() - began,
                    status: result.status,
                });
                if (window.motionDropNext && String(args[0]).endsWith('/step')) {
                    const timeout = window.motionDropNext === 'timeout';
                    window.motionDropNext = false;
                    if (timeout)
                        await new Promise((resolve) => {
                            const signal = args[1].signal;
                            if (signal.aborted) resolve();
                            else signal.addEventListener('abort', resolve, { once: true });
                        });
                    throw new TypeError('QA: response lost after commit');
                }
                return result;
            };
        }, addedRtt);
        if (process.env.YTT_PERF_ECHO_DELAY) {
            await p1.routeWebSocket(/localhost:8085/, (ws) => {
                const server = ws.connectToServer();
                server.onMessage((message) => {
                    if (String(message).includes('tabletop')) {
                        const timer = setTimeout(() => {
                            echoTimers.delete(timer);
                            ws.send(message);
                            report.delayedEchoFrames = (report.delayedEchoFrames ?? 0) + 1;
                        }, Number(process.env.YTT_PERF_ECHO_DELAY));
                        echoTimers.add(timer);
                    } else ws.send(message);
                });
            });
        }
        for (const [role, page] of pages.entries()) {
            await page.context().setExtraHTTPHeaders({ 'X-YTT-Perf': '1' });
            await page.context().addInitScript(() => {
                window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
                    supportsFiber: true,
                    roots: new Set(),
                    inject: () => 1,
                    onCommitFiberRoot: (_id, root) => {
                        window.__REACT_DEVTOOLS_GLOBAL_HOOK__.roots.add(root);
                        if (window.engineProfile?.active) window.engineProfile.commits++;
                    },
                    onCommitFiberUnmount: () => {},
                };
            });
            page.on('pageerror', (e) => report.errors.push({ role, message: e.message }));
            page.on('requestfailed', (request) => {
                if (!request.url().includes('/api/')) return;
                report.failedRequests ??= [];
                report.failedRequests.push({
                    role,
                    path: new URL(request.url()).pathname,
                    error: request.failure()?.errorText,
                });
            });
            page.on('response', async (response) => {
                if (!response.url().includes('/api/')) return;
                await response.finished();
                const headers = await response.allHeaders();
                report.requests.push({
                    role,
                    path: new URL(response.url()).pathname,
                    status: response.status(),
                    timing: response.request().timing(),
                    server: headers['server-timing'],
                    id: headers['x-ytt-request-id'],
                });
            });
            await page.goto(
                base + (page === gm ? '/campaigns/5/scenes/10?mode=session' : '/campaigns/5/play'),
            );
            await tabletop(page).waitFor({ timeout: 60000 });
            await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
            await page.waitForFunction(() =>
                window.movementFrames.some((f) => f.includes('subscription_succeeded')),
            );
            await sleep(2500);
            report.environment ??= await instrument(page);
            if (report.environment && !(await page.evaluate(() => !!window.perfRenderer)))
                await instrument(page);
            await page.evaluate((id) => {
                const r = window.perfRenderer,
                    p = window.engineProfile;
                p.motion = [];
                p.masks = [];
                p.events = [];
                r.app.ticker.add(
                    () => {
                        if (p.active) {
                            const v = r.tokens.views.get(id);
                            p.motion.push({
                                t: performance.now(),
                                x: v?.x,
                                y: v?.y,
                                cx: v?.model.x,
                                cy: v?.model.y,
                                reveal: r.vision.composite?.uniforms.uniforms.uProgress,
                                focus: r.vision.composite?.uniforms.uniforms.uFocus?.[0],
                                pending: r.store.directCommandPending,
                                revision: r.store.getSnapshot().scene.revision,
                            });
                        }
                    },
                    undefined,
                    -61,
                );
                const sync = r.vision.sync.bind(r.vision);
                r.vision.sync = (...args) => {
                    const old = r.vision.polygonKey;
                    const result = sync(...args);
                    if (p.active && old !== r.vision.polygonKey)
                        p.masks.push({
                            t: performance.now(),
                            revision: r.store.getSnapshot().scene.revision,
                        });
                    return result;
                };
            }, hero.id);
            if (process.env.YTT_PERF_DIAGNOSTIC)
                await page.evaluate(() => {
                    const r = window.perfRenderer,
                        p = window.engineProfile;
                    p.diagnostic = [];
                    for (const method of ['finishMovement', 'sync']) {
                        const original = r.tokens[method].bind(r.tokens);
                        r.tokens[method] = (...args) => {
                            if (p.active && (method === 'sync' || r.tokens.isMoving(args[0])))
                                p.diagnostic.push({
                                    method,
                                    args: method === 'sync' ? args[3] : args,
                                    stack: new Error().stack,
                                });
                            return original(...args);
                        };
                    }
                });
        }
        for (const input of process.env.YTT_PERF_INPUTS?.split(',') ?? ['wasd', 'click', 'drag'])
            for (let repeat = 0; repeat < Number(process.env.YTT_PERF_REPEATS ?? 3); repeat++) {
                // A clear part of the courtyard, using the existing hero and original geometry.
                const origin =
                        input === 'wall' || input === 'detour'
                            ? { x: 480, y: 830 }
                            : input === 'door'
                              ? { x: 770, y: 600 }
                              : { x: 570, y: 830 },
                    destination = input === 'detour' ? { x: 600, y: 600 } : { x: 790, y: 830 };
                await api(gm, '/tokens/' + hero.id, 'PATCH', origin);
                await sleep(700);
                await p1.waitForFunction(
                    ({ id, origin }) => {
                        const token = window.perfRenderer.store
                            .getSnapshot()
                            .scene.tokens.find((t) => t.id === id);
                        return token?.x === origin.x && token.y === origin.y;
                    },
                    { id: hero.id, origin },
                );
                for (const page of pages)
                    await page.evaluate(() => {
                        const r = window.perfRenderer;
                        r.camera.state = {
                            x: r.app.canvas.clientWidth / 2 - 680 * 0.8,
                            y: r.app.canvas.clientHeight * 0.4 - 830 * 0.8,
                            zoom: 0.8,
                        };
                        r.camera.stop();
                    });
                await sleep(100);
                await p1.bringToFront();
                const screen = async (point) =>
                    p1.evaluate((point) => {
                        const r = window.perfRenderer,
                            p = r.world.toGlobal(point),
                            b = r.app.canvas.getBoundingClientRect();
                        return { x: p.x + b.x, y: p.y + b.y };
                    }, point);
                const start = await screen(origin),
                    target = await screen(destination);
                assert.ok(
                    await p1.evaluate(
                        ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
                        start,
                    ),
                    'Hero must not be covered by HUD',
                );
                assert.ok(
                    await p1.evaluate(
                        ({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS',
                        target,
                    ),
                    'Destination must not be covered by HUD',
                );
                await p1.mouse.click(start.x, start.y);
                if (['wasd', 'wall', 'door'].includes(input) || input.startsWith('fault-')) {
                    await p1.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
                    await p1.waitForFunction(
                        () => !!window.perfRenderer.store.getSnapshot().directControl,
                    );
                }
                report.requests = [];
                let profile, trace;
                if (process.env.YTT_PERF_TRACE === '1') {
                    profile = await p1.context().newCDPSession(p1);
                    trace = [];
                    await profile.send('Profiler.enable');
                    await profile.send('Profiler.setSamplingInterval', { interval: 100 });
                    await profile.send('Profiler.start');
                    profile.on('Tracing.dataCollected', (data) => trace.push(...data.value));
                    await profile.send('Tracing.start', {
                        categories:
                            'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline',
                        options: 'record-as-much-as-possible',
                    });
                }
                for (const page of pages) {
                    await page.evaluate(() => {
                        window.engineProfile.motion = [];
                        window.engineProfile.masks = [];
                        window.engineProfile.events = [];
                        window.motionRequests = [];
                    });
                    await begin(page);
                }
                const began = Date.now();
                if (input === 'receipt-replay') {
                    const { receiptScenario } = require('./movement-faults.cjs');
                    report.receiptReplay = await receiptScenario(p1, gm, hero.id);
                } else if (input.startsWith('fault-')) {
                    const { faultScenario } = require('./movement-faults.cjs');
                    report.faults ??= [];
                    report.faults.push(await faultScenario(input, p1, gm, hero.id));
                } else if (['wasd', 'wall', 'door'].includes(input)) {
                    for (let i = 0; i < Number(process.env.YTT_PERF_OSCILLATIONS ?? 1); i++) {
                        const key = input === 'wall' ? 'w' : i % 2 ? 'a' : 'd';
                        await p1.keyboard.down(key);
                        await sleep(Number(process.env.YTT_PERF_HOLD ?? 1400));
                        await p1.keyboard.up(key);
                    }
                    await sleep(1800);
                } else if (input === 'click') {
                    await p1.mouse.dblclick(target.x, target.y);
                    await sleep(3000);
                } else {
                    await p1.mouse.move(start.x, start.y);
                    await p1.mouse.down();
                    await p1.mouse.move(target.x, target.y, { steps: 30 });
                    await p1.mouse.up();
                    await sleep(2500);
                }
                const samples = [];
                report.motionRequests = await p1.evaluate(() => window.motionRequests ?? []);
                for (const [role, page] of pages.entries()) {
                    const raw = await end(page);
                    fs.writeFileSync(
                        `${out}/${input}-${repeat}-role${role}.json`,
                        JSON.stringify(raw),
                    );
                    const dt = raw.frames.slice(1).map((t, i) => t - raw.frames[i]);
                    const motion = raw.motion;
                    let stalls = 0,
                        maxStall = 0,
                        lastMoved = motion[0]?.t;
                    for (let i = 1; i < motion.length; i++) {
                        if (
                            Math.hypot(
                                motion[i].x - motion[i - 1].x,
                                motion[i].y - motion[i - 1].y,
                            ) > 0.01
                        ) {
                            maxStall = Math.max(maxStall, motion[i].t - lastMoved);
                            lastMoved = motion[i].t;
                        } else if (motion[i].pending) stalls++;
                    }
                    samples.push({
                        role,
                        fps: 1000 / (dt.reduce((s, x) => s + x, 0) / dt.length),
                        frameMs: stats(dt),
                        longTasks: raw.longTasks,
                        commits: raw.commits,
                        gpuMs: stats(raw.gpu),
                        masks: raw.masks.length,
                        maskIntervals: stats(
                            raw.masks.slice(1).map((m, i) => m.t - raw.masks[i].t),
                        ),
                        maxStall,
                        stalls,
                        firstMovementMs:
                            motion.find((m) => Math.hypot(m.x - origin.x, m.y - origin.y) > 0.1)
                                ?.t - motion[0]?.t,
                        distance: motion.length
                            ? Math.hypot(motion.at(-1).x - origin.x, motion.at(-1).y - origin.y)
                            : 0,
                        travelled: motion
                            .slice(1)
                            .reduce(
                                (sum, m, i) =>
                                    sum + Math.hypot(m.x - motion[i].x, m.y - motion[i].y),
                                0,
                            ),
                        maxVisualStep: Math.max(
                            0,
                            ...motion
                                .slice(1)
                                .map((m, i) => Math.hypot(m.x - motion[i].x, m.y - motion[i].y)),
                        ),
                        visualLatency: (() => {
                            const event = raw.events.find((e) =>
                                input === 'wasd' ? e.type === 'keydown' : e.type === 'pointerup',
                            );
                            const frame = motion.find(
                                (m) =>
                                    event &&
                                    m.t >= event.t &&
                                    Math.hypot(m.x - origin.x, m.y - origin.y) > 0.1,
                            );
                            return frame && event ? frame.t - event.t : null;
                        })(),
                        operations: Object.fromEntries(
                            Object.entries(raw.ops).map(([k, v]) => [k, stats(v)]),
                        ),
                    });
                }
                report.cases.push({
                    input,
                    repeat,
                    elapsed: Date.now() - began,
                    roles: samples,
                    requests: [...report.requests],
                    motionRequests: report.motionRequests,
                });
                if (profile) {
                    const cpu = await profile.send('Profiler.stop');
                    fs.writeFileSync(
                        `${out}/${input}-${repeat}.cpuprofile`,
                        JSON.stringify(cpu.profile),
                    );
                    const done = new Promise((resolve) =>
                        profile.once('Tracing.tracingComplete', resolve),
                    );
                    await profile.send('Tracing.end');
                    await done;
                    fs.writeFileSync(
                        `${out}/${input}-${repeat}-trace.json`,
                        JSON.stringify({ traceEvents: trace }),
                    );
                    await profile.detach();
                }
                await p1.screenshot({ path: `${out}/${input}-${repeat}.png` });
                assert.ok(
                    samples[pages.indexOf(p1)].travelled >
                        (input === 'receipt-replay'
                            ? 10
                            : ['wasd', 'wall', 'door'].includes(input) || input.startsWith('fault-')
                              ? 20
                              : 100),
                    'Scenario must actually move the hero',
                );
                if (['drag', 'detour'].includes(input) && process.env.YTT_PERF_REQUIRE_PLAYBACK) {
                    for (const sample of samples)
                        assert.ok(
                            sample.maxVisualStep < 10,
                            `Drag playback must not teleport for role ${sample.role}: ${sample.maxVisualStep}`,
                        );
                }
                if (['wall', 'door', 'detour'].includes(input)) {
                    const accepted = (await api(gm, '/scenes/10/snapshot')).tokens.find(
                        (t) => t.id === hero.id,
                    );
                    if (input === 'wall')
                        assert.ok(
                            accepted.y >= 750 && accepted.y < 810,
                            'wall footprint must stop W',
                        );
                    if (input === 'door')
                        assert.ok(
                            accepted.x <= 810 && accepted.x > 790,
                            'closed door footprint must stop D',
                        );
                    if (input === 'detour')
                        assert.ok(
                            Math.hypot(accepted.x - destination.x, accepted.y - destination.y) <
                                0.003,
                            'detour must reach accepted destination',
                        );
                }
                console.log(
                    JSON.stringify({
                        input,
                        repeat,
                        roles: samples.map(
                            ({
                                role,
                                fps,
                                frameMs,
                                firstMovementMs,
                                masks,
                                maskIntervals,
                                distance,
                            }) => ({
                                role,
                                fps,
                                p95: frameMs.p95,
                                firstMovementMs,
                                masks,
                                maskInterval: maskIntervals.mean,
                                distance,
                            }),
                        ),
                        http: stats(
                            report.requests
                                .filter((r) => r.path.endsWith('/step') || r.path.endsWith('/move'))
                                .map((r) => r.timing.responseEnd),
                        ),
                    }),
                );
                fs.writeFileSync(out + '/motion-report.json', JSON.stringify(report, null, 2));
                await p1.keyboard.press('Escape');
                await sleep(300);
            }
        assert.deepEqual(report.errors, [], 'No browser exceptions expected');
    } finally {
        try {
            if (saved && gm) {
                for (const token of saved.scene.tokens)
                    await api(gm, '/tokens/' + token.id, 'PATCH', { x: token.x, y: token.y });
                await api(gm, '/scenes/10/grid', 'PUT', saved.scene.grid);
                if ((await api(gm, '/campaigns/5')).activeSceneId !== saved.active)
                    await api(gm, '/campaigns/5/activate', 'POST', { sceneId: saved.active });
                const final = await api(gm, '/scenes/10/snapshot');
                assert.deepEqual(final.tokens, saved.scene.tokens);
                assert.deepEqual(final.props, saved.scene.props);
                assert.deepEqual(final.structure, saved.scene.structure);
                if (backed) memory('restore');
                report.restored = true;
                fs.unlinkSync(backup);
            } else if (backed) memory('restore');
        } finally {
            fs.writeFileSync(out + '/motion-report.json', JSON.stringify(report, null, 2));
            for (const timer of echoTimers) clearTimeout(timer);
            await browser.close();
        }
    }
}
main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
