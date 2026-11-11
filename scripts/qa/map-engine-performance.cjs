/* eslint-disable @typescript-eslint/no-require-imports -- Local production-build profiling. */
/* global require, module, process, console, window, performance, PerformanceObserver, setTimeout, URL */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, base, tabletop } = require('./map07a.cjs');
const phase = process.argv[2] ?? 'baseline';
const out = `artifacts/map-engine-performance/${phase}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (values) => {
    const a = [...values].sort((a, b) => a - b),
        n = a.length;
    return n
        ? {
              n,
              mean: a.reduce((s, v) => s + v, 0) / n,
              p50: a[Math.floor(n * 0.5)],
              p95: a[Math.min(n - 1, Math.floor(n * 0.95))],
              p99: a[Math.min(n - 1, Math.floor(n * 0.99))],
              max: a[n - 1],
              sum: a.reduce((s, v) => s + v, 0),
          }
        : { n: 0 };
};
async function instrument(page) {
    return page.evaluate(() => {
        const roots = window.__REACT_DEVTOOLS_GLOBAL_HOOK__.roots;
        const find = (fiber) => {
            if (!fiber) return;
            if (fiber.memoizedProps?.rendererRef?.current?.app)
                return fiber.memoizedProps.rendererRef.current;
            return find(fiber.child) ?? find(fiber.sibling);
        };
        const r = [...roots].map((root) => find(root.current)).find(Boolean);
        if (!r) throw Error('Renderer not found');
        window.perfRenderer = r;
        const app = r.app,
            gl = app.renderer.gl;
        const p = (window.engineProfile = {
            active: false,
            frames: [],
            ops: {},
            longTasks: [],
            draws: [],
            commits: 0,
            inputs: [],
            inputAge: [],
            gpu: [],
        });
        const wrap = (target, key, name) => {
            if (typeof target?.[key] !== 'function') return;
            const original = target[key];
            target[key] = function (...args) {
                if (!p.active) return original.apply(this, args);
                const start = performance.now();
                try {
                    return original.apply(this, args);
                } finally {
                    (p.ops[name] ??= []).push(performance.now() - start);
                }
            };
        };
        for (const [name, object, keys] of [
            ['dragRoute', r.input.dragRoute, ['preview']],
            ['overlay', r.input.overlay, ['showMovement', 'showDestination']],
            [
                'input',
                r.input,
                ['reapplyPreview', 'previewDrag', 'refresh', 'refreshBuild', 'local'],
            ],
            ['props', r.props, ['sync', 'hit', 'selection', 'preview']],
            ['tokens', r.tokens, ['sync', 'hit', 'selection', 'tickMovement']],
            ['terrain', r.terrain, ['tick', 'sync']],
            ['structure', r.structure, ['sync']],
            ['vision', r.vision, ['sync', 'tick']],
            ['lighting', r.lighting, ['sync', 'tick', 'accept']],
            ['fog', r.fog, ['update']],
            ['store', r.store, ['emit']],
            ['renderer', r, ['syncImages']],
            ['objects', r.input.objects, ['move', 'preview']],
        ])
            for (const key of keys) wrap(object, key, `${name}.${key}`);
        let draws = 0;
        for (const key of [
            'drawElements',
            'drawArrays',
            'drawElementsInstanced',
            'drawArraysInstanced',
        ]) {
            const original = gl[key].bind(gl);
            gl[key] = (...args) => {
                if (p.active) draws++;
                return original(...args);
            };
        }
        const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const queries = [];
        let renderCount = 0;
        const render = app.renderer.render.bind(app.renderer);
        app.renderer.render = (...args) => {
            if (!p.active) return render(...args);
            const start = performance.now();
            const q = ext && renderCount++ % 16 === 0 ? gl.createQuery() : null;
            if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            const result = render(...args);
            if (q) {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                queries.push(q);
            }
            (p.ops['pixi.render'] ??= []).push(performance.now() - start);
            return result;
        };
        let lastInput = 0,
            lastCounted = 0;
        app.canvas.addEventListener(
            'pointermove',
            () => {
                if (p.active) {
                    lastInput = performance.now();
                    p.inputs.push(lastInput);
                }
            },
            { capture: true },
        );
        app.ticker.add(
            () => {
                while (
                    queries.length &&
                    gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)
                ) {
                    const q = queries.shift();
                    if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && p.active)
                        p.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
                    gl.deleteQuery(q);
                }
                if (!p.active) return;
                p.frames.push(performance.now());
                p.draws.push(draws);
                draws = 0;
                if (lastInput !== lastCounted) {
                    p.inputAge.push(performance.now() - lastInput);
                    lastCounted = lastInput;
                }
            },
            undefined,
            -60,
        );
        new PerformanceObserver((list) => {
            if (p.active)
                for (const e of list.getEntries())
                    p.longTasks.push({ start: e.startTime, duration: e.duration });
        }).observe({ type: 'longtask' });
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
            gpuTimer: !!ext,
            dpr: window.devicePixelRatio,
            canvas: [app.canvas.width, app.canvas.height],
            scene: {
                tokens: r.store.getSnapshot().scene.tokens.length,
                props: r.store.getSnapshot().scene.props.length,
            },
            textures: [...r.textures.values()].map((t) => ({ width: t.width, height: t.height })),
            camera: { ...r.camera.state },
        };
    });
}
async function begin(page) {
    await page.evaluate(() => {
        const p = window.engineProfile;
        for (const key of ['frames', 'draws', 'inputs', 'inputAge', 'longTasks', 'gpu'])
            p[key] = [];
        p.ops = {};
        p.commits = 0;
        p.active = true;
    });
}
async function end(page) {
    return page.evaluate(() => {
        window.engineProfile.active = false;
        return window.engineProfile;
    });
}
async function point(page, kind) {
    return page.evaluate((kind) => {
        const r = window.perfRenderer,
            world = r.world,
            b = r.app.canvas.getBoundingClientRect();
        const objects =
            kind === 'prop' ? [...r.props.views.values()] : [...r.tokens.views.values()];
        const candidates = objects.filter((v) => !v.model.isLocked).reverse();
        for (const v of candidates) {
            const p = world.toGlobal(v);
            const x = p.x + b.x,
                y = p.y + b.y;
            if (
                x > b.x + 130 &&
                x < b.right - 130 &&
                y > b.y + 140 &&
                y < b.bottom - 140 &&
                (kind !== 'prop' || r.props.hit(v) === v.model.id) &&
                (kind !== 'prop' || !r.tokens.hit(v))
            )
                return { x, y, id: v.model.id };
        }
        throw Error('No visible draggable ' + kind);
    }, kind);
}
async function motion(page, fn, ms = 5000) {
    const start = Date.now();
    for (let i = 0; Date.now() - start < ms; i++) {
        const elapsed = Date.now() - start;
        await fn(elapsed / ms, i);
        await sleep(Math.max(0, start + (i + 1) * 16.667 - Date.now()));
    }
}
async function scenario(page, name) {
    const box = await tabletop(page).boundingBox();
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const saved = await page.evaluate(() => ({ ...window.perfRenderer.camera.state }));
    let target;
    if (name.includes('drag')) target = await point(page, name === 'prop-drag' ? 'prop' : 'token');
    if (name === 'pan') {
        await page.keyboard.down('Space');
        await page.mouse.move(center.x, center.y);
        await page.mouse.down();
    }
    if (target) {
        await page.mouse.move(target.x, target.y);
        if (name === 'token-override-drag') await page.keyboard.down('Alt');
        await page.mouse.down();
    }
    await begin(page);
    if (name === 'idle') await sleep(5000);
    else if (name === 'zoom')
        await motion(page, async (t, i) => {
            if (i % 12 === 0) {
                await page.mouse.move(center.x, center.y);
                await page.mouse.wheel(0, t < 0.5 ? -30 : 30);
            }
        });
    else
        await motion(page, (t) => {
            const anchor = target ?? center;
            const dx =
                name === 'hover'
                    ? Math.sin(t * Math.PI * 6) * box.width * 0.35
                    : Math.sin(t * Math.PI * 4) * 100;
            const dy =
                name === 'hover'
                    ? Math.cos(t * Math.PI * 4) * box.height * 0.3
                    : Math.sin(t * Math.PI * 2) * 65;
            return page.mouse.move(anchor.x + dx, anchor.y + dy);
        });
    const data = await end(page);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.keyboard.up('Space');
    await page.evaluate((camera) => {
        const r = window.perfRenderer;
        r.camera.state = camera;
        r.camera.stop();
        r.store.select(null);
    }, saved);
    await sleep(600);
    const dt = data.frames.slice(1).map((t, i) => t - data.frames[i]);
    const result = {
        name,
        fps: 1000 / (dt.reduce((a, b) => a + b, 0) / dt.length),
        frameMs: stats(dt),
        over25ms: dt.filter((x) => x > 25).length,
        longTasks: data.longTasks,
        drawCalls: stats(data.draws),
        gpuMs: stats(data.gpu),
        inputToTickMs: stats(data.inputAge),
        commits: data.commits,
        operations: Object.fromEntries(Object.entries(data.ops).map(([k, v]) => [k, stats(v)])),
    };
    fs.writeFileSync(`${out}/${name}-raw.json`, JSON.stringify(data));
    return result;
}
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
        cases: [],
        errors: [],
        blockedWrites: [],
        environment: {
            browser: browser.version(),
            viewport: '1680x1050',
            headless: true,
            scene: 10,
            build: JSON.parse(fs.readFileSync('public/build/manifest.json', 'utf8'))[
                'resources/js/app.tsx'
            ].file,
        },
    };
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        const page = await login(
            browser,
            accounts.find((a) => a.id === 1),
        );
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
        const baseline = await api(page, '/scenes/10/snapshot');
        page.on('pageerror', (e) => report.errors.push(e.message));
        await page.route('**/api/**', async (route) => {
            if (
                route.request().method() !== 'GET' &&
                /\/api\/(scenes|tokens|props)\//.test(route.request().url())
            ) {
                report.blockedWrites.push(new URL(route.request().url()).pathname);
                await route.abort();
            } else await route.continue();
        });
        await page.goto(
            base +
                '/campaigns/5/scenes/10?mode=' +
                (process.env.YTT_PERF_MODE ??
                    (process.env.YTT_PERF_EDITOR === '1' ? 'prepare' : 'session')),
        );
        await tabletop(page).waitFor({ timeout: 60000 });
        await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
        if (process.env.YTT_PERF_EDITOR === '1') {
            await page.getByTitle('Открыть редактор карты', { exact: true }).click();
            await page.locator('.map-editor-open').waitFor();
            report.environment.mode = 'Map Editor';
        }
        await sleep(6000);
        report.environment = { ...report.environment, ...(await instrument(page)) };
        const propCount = Number(process.env.YTT_PERF_PROP_COUNT ?? 75);
        const tokenCount = Number(process.env.YTT_PERF_TOKEN_COUNT ?? 2);
        if (propCount !== 75 || tokenCount !== 2) {
            await page.evaluate(
                ({ propCount, tokenCount }) => {
                    const r = window.perfRenderer,
                        state = r.store.getSnapshot(),
                        scene = state.scene;
                    const props = [...scene.props],
                        tokens = [...scene.tokens];
                    for (let i = props.length; i < propCount; i++) {
                        const p = scene.props[i % scene.props.length];
                        props.push({
                            ...p,
                            id: `perf-prop-${i}`,
                            x: 80 + (i % 20) * 65,
                            y: 100 + (Math.floor(i / 20) % 13) * 65,
                            isLocked: false,
                        });
                    }
                    for (let i = tokens.length; i < tokenCount; i++) {
                        const t = scene.tokens[i % scene.tokens.length];
                        tokens.push({
                            ...t,
                            id: `perf-token-${i}`,
                            name: `Profile ${i}`,
                            x: 100 + (i % 15) * 85,
                            y: 150 + Math.floor(i / 15) * 110,
                        });
                    }
                    r.store.emit({ ...state, scene: { ...scene, props, tokens } });
                },
                { propCount, tokenCount },
            );
            await sleep(1500);
            report.environment.scene = { props: propCount, tokens: tokenCount, browserOnly: true };
        }
        await page.screenshot({ path: out + '/scene.png' });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Performance.enable');
        report.metricsBefore = (await cdp.send('Performance.getMetrics')).metrics;
        const names = process.env.YTT_PERF_CASES?.split(',') ?? [
            'idle',
            'hover',
            'pan',
            'zoom',
            'prop-drag',
            'token-drag',
            'token-override-drag',
        ];
        for (const name of names) {
            const r = await scenario(page, name);
            report.cases.push(r);
            console.log(
                JSON.stringify({
                    name,
                    fps: r.fps,
                    p95: r.frameMs.p95,
                    longTasks: r.longTasks.length,
                    render: r.operations['pixi.render'],
                    commits: r.commits,
                }),
            );
            fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        }
        report.metricsAfter = (await cdp.send('Performance.getMetrics')).metrics;
        if (process.env.YTT_PERF_TRACE === '1') {
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
            await cdp.send('Profiler.start');
            const events = [];
            cdp.on('Tracing.dataCollected', (data) => events.push(...data.value));
            await cdp.send('Tracing.start', {
                categories:
                    'devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline',
                options: 'record-as-much-as-possible',
            });
            await scenario(page, 'zoom');
            const { profile } = await cdp.send('Profiler.stop');
            fs.writeFileSync(out + '/zoom.cpuprofile', JSON.stringify(profile));
            const done = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
            await cdp.send('Tracing.end');
            await done;
            fs.writeFileSync(out + '/zoom-trace.json', JSON.stringify({ traceEvents: events }));
        }
        const final = await api(page, '/scenes/10/snapshot');
        assert.deepEqual(final, baseline, 'Scene 10 must remain unchanged');
        report.unchanged = true;
        assert.deepEqual(report.blockedWrites, [], 'No scene mutations expected');
    } finally {
        fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        await browser.close();
    }
}
if (require.main === module)
    main().catch((e) => {
        console.error(e);
        process.exitCode = 1;
    });
module.exports = { instrument, begin, end, stats };
