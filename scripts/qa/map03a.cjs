/* eslint-disable @typescript-eslint/no-require-imports -- Native local browser QA. */
/* global require, __dirname, process, console, document, window, fetch, crypto, FormData, File, Event, Buffer, requestAnimationFrame, performance, WheelEvent */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const root = path.resolve(__dirname, '../..'),
    out = path.join(
        root,
        process.env.YTT_TERRAIN_ART === '1'
            ? 'artifacts/terrain-art'
            : process.env.YTT_LONG_STROKE === 'jitter'
              ? 'artifacts/terrain-long/browser-jitter'
              : process.env.YTT_LONG_STROKE
                ? 'artifacts/terrain-long/browser'
                : 'artifacts/map03a',
    ),
    base = 'http://localhost:8090';
fs.mkdirSync(out, { recursive: true });
const art = process.env.YTT_TERRAIN_ART === '1';
const report = { checks: [], errors: [], strokes: [], restored: false };
async function api(page, url, method = 'GET', body) {
    return page.evaluate(
        async ({ url, method, body }) => {
            const { csrf } = await (await fetch('/api/session')).json();
            const r = await fetch('/api' + url, {
                method,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrf,
                },
                body: body
                    ? JSON.stringify({ ...body, clientMutationId: crypto.randomUUID() })
                    : undefined,
            });
            return {
                status: r.status,
                data: (r.headers.get('Content-Type') ?? '').includes('application/json')
                    ? await r.json()
                    : null,
            };
        },
        { url, method, body },
    );
}
async function snapshot(page) {
    const r = await api(page, '/scenes/5/snapshot');
    assert.equal(r.status, 200);
    return r.data;
}
const mapState = (s) => ({
    enabled: !!s.mapWorld,
    width: s.width,
    height: s.height,
    grid: s.grid,
    map: s.map
        ? {
              assetId: s.map.asset.id,
              x: s.map.x,
              y: s.map.y,
              width: s.map.width,
              height: s.map.height,
              crop: s.map.crop ?? null,
          }
        : null,
});
const hashes = (s) => Object.fromEntries(s.terrain.chunks.map((c) => [c.key, c.hash]));
async function editor(page) {
    const close = page.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
    if (await close.isVisible()) await close.click();
    await page
        .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
        .click();
    await page.getByRole('toolbar', { name: 'Инструменты редактора карты' }).waitFor();
    await page.getByRole('button', { name: 'Terrain', exact: true }).click();
}
async function slider(page, name, value) {
    await page.getByLabel(name, { exact: true }).evaluate((el, value) => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
        ).set;
        setter.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}
async function stroke(page, points) {
    const response = page.waitForResponse(
        (r) => r.url().endsWith('/api/scenes/5/terrain') && r.request().method() === 'POST',
    );
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 10 });
    await page.mouse.up();
    const r = await response;
    assert.equal(r.status(), 200, JSON.stringify(await r.json()));
    await page.locator('.map-editor-status .save-saved').waitFor();
}
async function history(page, redo = false) {
    const response = page.waitForResponse(
        (r) => r.url().endsWith('/edit-history') && r.request().method() === 'POST',
    );
    await page
        .getByRole('button', { name: redo ? 'Повторить правку' : 'Отменить правку', exact: true })
        .click();
    const r = await response;
    assert.equal(r.status(), 200, JSON.stringify(await r.json()));
    await page.locator('.map-editor-status .save-saved').waitFor();
}
async function settle(page) {
    await page.waitForTimeout(1400);
}
async function createTexture(page, name, kind) {
    return page.evaluate(
        async ({ name, kind }) => {
            // Deliberately generated diagnostic textures, tileable at 256 px. No external art dependency.
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 256;
            const ctx = canvas.getContext('2d'),
                image = ctx.createImageData(256, 256);
            const hash = (x, y) => {
                let n = (x * 374761393 + y * 668265263) | 0;
                n = Math.imul(n ^ (n >>> 13), 1274126177);
                return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
            };
            for (let y = 0; y < 256; y++)
                for (let x = 0; x < 256; x++) {
                    const noise = hash(x, y),
                        wave =
                            Math.sin((x / 256) * Math.PI * 8) * Math.cos((y / 256) * Math.PI * 6);
                    const i = (y * 256 + x) * 4,
                        tone = (noise - 0.5) * 40 + wave * 12;
                    const colors = {
                        grass: [62, 83, 37],
                        dirt: [143, 109, 71],
                        moss: [98, 109, 48],
                        stone: [105, 104, 102],
                        sand: [168, 148, 101],
                        slate: [63, 78, 79],
                    };
                    const rgb = colors[kind];
                    const joint =
                        kind === 'stone' && (y % 32 < 2 || (x + Math.floor(y / 32) * 16) % 32 < 2);
                    const shade = joint ? -45 : 0;
                    for (let c = 0; c < 3; c++) image.data[i + c] = rgb[c] + tone + shade;
                    image.data[i + 3] = 255;
                }
            ctx.putImageData(image, 0, 0);
            for (let i = 0; i < 2600; i++) {
                const x = hash(i, 8) * 256,
                    y = hash(i, 12) * 256,
                    r = hash(i, 22);
                for (const dx of [-256, 0, 256])
                    for (const dy of [-256, 0, 256]) {
                        if (['grass', 'moss'].includes(kind)) {
                            ctx.strokeStyle = r > 0.5 ? '#a0ac5a88' : '#253b2188';
                            ctx.lineWidth = 0.7;
                            ctx.beginPath();
                            ctx.moveTo(x + dx, y + dy);
                            ctx.lineTo(x + dx + 1 + r * 3, y + dy - 3 - r * 6);
                            ctx.stroke();
                        } else {
                            ctx.fillStyle = r > 0.5 ? '#cbb58999' : '#60492e88';
                            ctx.beginPath();
                            ctx.ellipse(
                                x + dx,
                                y + dy,
                                1 + r * 1.6,
                                0.6 + r,
                                r * 3,
                                0,
                                Math.PI * 2,
                            );
                            ctx.fill();
                        }
                    }
            }
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            const { csrf } = await (await fetch('/api/session')).json();
            const form = new FormData();
            form.append('category', 'art');
            form.append('file', new File([blob], name + '.png', { type: 'image/png' }));
            const r = await fetch('/api/library/assets', {
                method: 'POST',
                headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrf },
                body: form,
            });
            if (!r.ok) throw Error('Texture upload failed: ' + r.status);
            return r.json();
        },
        { name, kind },
    );
}
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, player, baseline;
    const assets = [],
        materials = [],
        edits = [];
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
                'utf8',
            ),
        );
        const pages = [];
        for (const id of [1, 2]) {
            const context = await browser.newContext({
                viewport: { width: 1600, height: 1040 },
                reducedMotion: 'reduce',
            });
            await context.addInitScript(() => {
                window.__terrainFrames = [];
                let previous = performance.now();
                const frame = (now) => {
                    window.__terrainFrames.push(now - previous);
                    window.__terrainLongFrames?.push(now - previous);
                    previous = now;
                    if (window.__terrainFrames.length > 2000) window.__terrainFrames.shift();
                    requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
                window.__terrainGpu = { created: 0, deleted: 0 };
                for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
                    const create = type.prototype.createTexture,
                        remove = type.prototype.deleteTexture;
                    type.prototype.createTexture = function (...args) {
                        window.__terrainGpu.created++;
                        return create.apply(this, args);
                    };
                    type.prototype.deleteTexture = function (...args) {
                        window.__terrainGpu.deleted++;
                        return remove.apply(this, args);
                    };
                }
                const Native = window.WebSocket,
                    sockets = new Set();
                window.WebSocket = class extends Native {
                    constructor(...args) {
                        super(...args);
                        sockets.add(this);
                        this.addEventListener('close', () => sockets.delete(this));
                    }
                };
                window.__mapQaDisconnect = () => sockets.forEach((s) => s.close());
            });
            const page = await context.newPage(),
                account = accounts.find((a) => a.id === id);
            page.on('pageerror', (e) => report.errors.push(e.message));
            await page.goto(base + '/login');
            await page.locator('input[type=email]').fill(account.email);
            await page.locator('input[name=password]').fill(account.password);
            await page.locator('form button.primary-button').click();
            await page.waitForURL((u) => !u.pathname.includes('login'));
            pages.push(page);
        }
        [gm, player] = pages;
        await gm.goto(base + '/campaigns/5/scenes/5?mode=prepare');
        await gm.locator('.canvas-host canvas').waitFor();
        const initial = await snapshot(gm);
        assert.equal(
            initial.terrain.chunks.length,
            0,
            'QA requires the unpainted permanent fixture; do not erase existing terrain',
        );
        baseline = initial;
        const state = mapState(baseline),
            blank = { ...state, enabled: true, map: null, grid: { ...state.grid, visible: false } };
        assert.equal(
            (await api(gm, '/scenes/5/map-world', 'POST', { expected: state, value: blank }))
                .status,
            200,
        );
        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        await editor(gm);
        if (art) {
            await settle(gm);
            await gm.screenshot({ path: path.join(out, 'empty-mapworld.png') });
        }
        const received = [];
        player.on('websocket', (socket) =>
            socket.on('framereceived', ({ payload }) => {
                try {
                    const frame = JSON.parse(String(payload));
                    const e = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    if (e?.type === 'terrain.updated') received.push(e);
                } catch {
                    /* protocol */
                }
            }),
        );
        await player.goto(base + '/campaigns/5/play');
        await player.locator('.canvas-host canvas').waitFor();
        for (const [name, kind] of [
            ['MAP-03A Meadow', 'grass'],
            ['MAP-03A Ochre path', 'dirt'],
            ...(art
                ? [
                      ['Stone', 'stone'],
                      ['Moss', 'moss'],
                      ['Sand', 'sand'],
                      ['Slate', 'slate'],
                  ]
                : []),
        ]) {
            const asset = await createTexture(gm, name, kind);
            assets.push(asset.id);
            const r = await api(gm, '/library/materials', 'POST', {
                name,
                type: 'terrain',
                assetId: asset.id,
                repeatSize: 240,
                rotation: kind === 'grass' ? 12 : 0,
                variation: { offset: kind !== 'stone', quarterTurns: false },
            });
            assert.equal(r.status, 200);
            materials.push(r.data);
        }
        assert.equal((await api(player, `/assets/${assets[0]}`)).status, 403);
        // Refresh the picker after creating the diagnostic material definitions.
        await gm.getByRole('button', { name: 'Objects', exact: true }).click();
        await gm.getByRole('button', { name: 'Terrain', exact: true }).click();
        gm.on('response', async (r) => {
            if (
                !r.url().endsWith('/api/scenes/5/terrain') ||
                r.request().method() !== 'POST' ||
                r.status() !== 200
            )
                return;
            const result = await r.json();
            edits.push(result.terrainEdit);
            report.strokes.push({
                chunks: result.terrain.chunks.length,
                bodyBytes: Buffer.byteLength(r.request().postData()),
                responseBytes: Buffer.byteLength(JSON.stringify(result)),
            });
        });
        await gm.getByRole('button', { name: 'Рисовать: MAP-03A Meadow', exact: true }).click();
        await gm.getByRole('button', { name: 'Показать карту целиком', exact: true }).click();
        const box = await gm.locator('.canvas-host canvas').boundingBox();
        const zoom = Math.min(
            (box.width - 32) / baseline.width,
            (box.height - 32) / baseline.height,
            1.2,
        );
        const at = (x, y) => ({
            x: box.x + (box.width - baseline.width * zoom) / 2 + x * zoom,
            y: box.y + (box.height - baseline.height * zoom) / 2 + y * zoom,
        });
        report.world = { width: baseline.width, height: baseline.height, zoom };
        const left = baseline.width * 0.16,
            right = baseline.width * 0.64,
            top = baseline.height * 0.24,
            bottom = baseline.height * 0.77;
        await slider(gm, 'Размер кисти', 720);
        await slider(gm, 'Мягкость', 110);
        for (let y = top; y <= bottom; y += 460) await stroke(gm, [at(left, y), at(right, y)]);
        await settle(gm);
        const grass = hashes(await snapshot(gm));
        assert.ok(Object.keys(grass).length > 4);
        await gm.getByRole('button', { name: 'Рисовать: MAP-03A Ochre path', exact: true }).click();
        await slider(gm, 'Размер кисти', 230);
        await slider(gm, 'Мягкость', art ? 60 : 200);
        await slider(gm, 'Непрозрачность', art ? 255 : 220);
        const road = [
            at(left, bottom),
            at(left + (right - left) * 0.28, top + (bottom - top) * 0.55),
            at(left + (right - left) * 0.58, top + (bottom - top) * 0.42),
            at(right, top),
        ];
        await stroke(gm, road);
        await settle(gm);
        const mixed = hashes(await snapshot(gm));
        if (art) {
            const fit = () =>
                gm.getByRole('button', { name: 'Показать карту целиком', exact: true }).click();
            const capture = async (name) => {
                for (const target of [0.29, 0.5, 1]) {
                    await fit();
                    const focus = at((left + right) / 2, (top + bottom) / 2);
                    let delta = Math.log(zoom / target) / 0.002;
                    while (Math.abs(delta) > 0.01) {
                        const step = Math.max(-150, Math.min(150, delta));
                        await gm.locator('.canvas-host canvas').evaluate(
                            (canvas, { focus, step }) => {
                                canvas.dispatchEvent(
                                    new WheelEvent('wheel', {
                                        clientX: focus.x,
                                        clientY: focus.y,
                                        deltaY: step,
                                        cancelable: true,
                                    }),
                                );
                            },
                            { focus, step },
                        );
                        delta -= step;
                    }
                    await gm.mouse.move(box.x + 8, box.y + 8);
                    await settle(gm);
                    assert.equal(
                        await gm
                            .locator('output[aria-label]')
                            .filter({ hasText: new RegExp(`^${Math.round(target * 100)}%$`) })
                            .count(),
                        1,
                    );
                    await gm.screenshot({
                        path: path.join(out, `${name}-${Math.round(target * 100)}.png`),
                    });
                }
                await fit();
            };
            const paint = async (name, diameter, softness, points) => {
                await gm.getByRole('button', { name: `Рисовать: ${name}`, exact: true }).click();
                await slider(gm, 'Размер кисти', diameter);
                await slider(gm, 'Мягкость', softness);
                await slider(gm, 'Непрозрачность', 255);
                await stroke(
                    gm,
                    points.map(([x, y]) => at(left + (right - left) * x, top + (bottom - top) * y)),
                );
            };
            await capture('forest-road');
            await paint('Stone', 330, 25, [
                [0.25, 0.36],
                [0.68, 0.36],
                [0.68, 0.59],
                [0.25, 0.59],
            ]);
            await paint('Moss', 95, 118, [
                [0.25, 0.29],
                [0.32, 0.41],
                [0.27, 0.57],
                [0.4, 0.66],
            ]);
            await paint('MAP-03A Ochre path', 95, 98, [
                [0.68, 0.58],
                [0.57, 0.68],
                [0.41, 0.7],
            ]);
            await capture('mossy-courtyard');
            await paint('Sand', 260, 105, [
                [0.25, 0.72],
                [0.49, 0.81],
                [0.69, 0.7],
            ]);
            await paint('Slate', 170, 72, [
                [0.76, 0.66],
                [0.82, 0.56],
                [0.88, 0.32],
            ]);
            await capture('six-material-landscape');
            for (let i = 0; i < 5; i++) {
                await history(gm);
                edits.pop();
            }
            assert.deepEqual(hashes(await snapshot(gm)), mixed);
            report.checks.push('Three visual compositions captured at 29%, 50%, 100%');
        }
        assert.notDeepEqual(mixed, grass);
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), grass);
        await history(gm, true);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        report.checks.push(
            'Real held-mouse multi-chunk paint, two materials, soft opacity, exact Paint Undo Redo',
        );
        await gm.getByRole('button', { name: 'Erase', exact: true }).click();
        await slider(gm, 'Размер кисти', 150);
        await stroke(gm, [
            at(left + (right - left) * 0.3, top),
            at(left + (right - left) * 0.3, top + 130),
        ]);
        assert.notDeepEqual(hashes(await snapshot(gm)), mixed);
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        // Cancel is local and must never send a completed stroke.
        const count = report.strokes.length;
        await gm.mouse.move(...Object.values(at(left + 200, top + 200)));
        await gm.mouse.down();
        await gm.mouse.move(...Object.values(at(left + 300, top + 200)), { steps: 6 });
        await gm.waitForTimeout(200);
        assert.deepEqual(
            hashes(await snapshot(gm)),
            mixed,
            'Live preview is not persisted before release',
        );
        await gm.screenshot({ path: path.join(out, 'terrain-live-preview.png') });
        await gm.keyboard.press('Escape');
        await gm.mouse.up();
        await settle(gm);
        assert.equal(report.strokes.length, count);
        await gm.getByRole('button', { name: 'Paint', exact: true }).click();
        await settle(gm);
        await gm.screenshot({ path: path.join(out, 'terrain-editor.png') });
        if (art && state.map) {
            const withReference = { ...blank, map: state.map };
            const texture = gm.waitForResponse(
                (r) => r.url().endsWith(`/api/assets/${state.map.assetId}`) && r.ok(),
            );
            assert.equal(
                (
                    await api(gm, '/scenes/5/map-world', 'POST', {
                        expected: blank,
                        value: withReference,
                    })
                ).status,
                200,
            );
            try {
                await texture;
                await settle(gm);
                await gm.screenshot({ path: path.join(out, 'reference-under-terrain.png') });
            } finally {
                assert.equal(
                    (
                        await api(gm, '/scenes/5/map-world', 'POST', {
                            expected: withReference,
                            value: blank,
                        })
                    ).status,
                    200,
                );
            }
        }
        report.paintPerformance = await gm.evaluate(() => {
            const frames = window.__terrainFrames.slice().sort((a, b) => a - b);
            return {
                frameMedianMs: frames[Math.floor(frames.length * 0.5)],
                frameP95Ms: frames[Math.floor(frames.length * 0.95)],
                maxFrameMs: frames.at(-1),
                gpu: window.__terrainGpu,
            };
        });
        await player.screenshot({ path: path.join(out, 'terrain-player.png') });
        assert.equal(
            await player.getByRole('complementary', { name: 'Terrain Painter' }).count(),
            0,
        );
        assert.equal((await api(player, `/scenes/5/terrain`, 'POST', {})).status, 403);
        report.checks.push(
            'Erase Undo, live preview stays local, Escape cancels without mutation, player renders terrain without editing tools',
        );
        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        await editor(gm);
        await settle(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        await gm.getByRole('button', { name: 'Рисовать: MAP-03A Ochre path', exact: true }).click();
        await slider(gm, 'Размер кисти', 120);
        await stroke(gm, [at(left, bottom - 120), at(left + 160, bottom - 180)]);
        const normalZoom = hashes(await snapshot(gm));
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        const softnessControl = gm.getByLabel('Мягкость', { exact: true });
        const opacityControl = gm.getByLabel('Непрозрачность', { exact: true });
        const previousSoftness = Number(await softnessControl.inputValue());
        const previousOpacity = Number(await opacityControl.inputValue());
        const finePath = [at(left + 20, bottom - 150), at(left + 200, bottom - 100)];
        await slider(gm, 'Размер кисти', 32);
        await slider(gm, 'Мягкость', 0);
        await slider(gm, 'Непрозрачность', 144);
        await stroke(gm, finePath);
        const fine = hashes(await snapshot(gm));
        assert.notDeepEqual(fine, mixed);
        await history(gm);
        const cdp = await gm.context().newCDPSession(gm);
        try {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            await stroke(gm, finePath);
            assert.deepEqual(
                hashes(await snapshot(gm)),
                fine,
                'Identical 32-wu stroke at 4× CPU throttle',
            );
        } finally {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
            await cdp.detach();
        }
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        await slider(gm, 'Размер кисти', 120);
        await slider(gm, 'Мягкость', previousSoftness);
        await slider(gm, 'Непрозрачность', previousOpacity);
        report.checks.push(
            '32-wu hard brush at partial opacity gives identical masks with 4× CPU throttle',
        );
        await gm.screenshot({ path: path.join(out, 'terrain-reload.png') });
        const anchor = at(left + 200, bottom - 180),
            factor = Math.exp(0.32);
        await gm.mouse.move(anchor.x, anchor.y);
        await gm.mouse.wheel(0, -160);
        await settle(gm);
        const zoomed = (p) => ({
            x: anchor.x + (p.x - anchor.x) * factor,
            y: anchor.y + (p.y - anchor.y) * factor,
        });
        await stroke(gm, [zoomed(at(left, bottom - 120)), zoomed(at(left + 160, bottom - 180))]);
        assert.deepEqual(
            hashes(await snapshot(gm)),
            normalZoom,
            'Identical world brush at a different zoom',
        );
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        const startPan = zoomed(at(left + 100, bottom - 100));
        await gm.mouse.move(startPan.x, startPan.y);
        await gm.keyboard.down('Space');
        await gm.mouse.down();
        await gm.mouse.move(startPan.x + 50, startPan.y + 25, { steps: 5 });
        await gm.mouse.up();
        await gm.keyboard.up('Space');
        const panned = (p) => ({ x: zoomed(p).x + 50, y: zoomed(p).y + 25 });
        await stroke(gm, [panned(at(left, bottom - 120)), panned(at(left + 160, bottom - 180))]);
        assert.deepEqual(hashes(await snapshot(gm)), normalZoom, 'Identical world brush after pan');
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        await gm.mouse.move(
            panned(at(left + 100, bottom - 100)).x,
            panned(at(left + 100, bottom - 100)).y,
        );
        await gm.screenshot({ path: path.join(out, 'terrain-zoom-cursor.png') });
        const beforeGpu = await gm.evaluate(() => ({ ...window.__terrainGpu }));
        for (let cycle = 0; cycle < 3; cycle++) {
            for (const direction of [1, -1]) {
                await gm.mouse.move(620, 450);
                await gm.mouse.down({ button: 'middle' });
                await gm.mouse.move(620 + direction * 900, 450, { steps: 8 });
                await gm.mouse.up({ button: 'middle' });
                await settle(gm);
            }
        }
        const afterGpu = await gm.evaluate(() => ({ ...window.__terrainGpu }));
        report.gpuPanCycles = { before: beforeGpu, after: afterGpu };
        assert.ok(afterGpu.deleted > beforeGpu.deleted, 'Offscreen terrain releases GPU textures');
        assert.ok(
            afterGpu.created - afterGpu.deleted <= beforeGpu.created - beforeGpu.deleted + 16,
            'Repeated pan does not accumulate GPU resources',
        );
        report.checks.push(
            'Identical world-space masks at 69% and 96% zoom, including Space-drag pan; brush cursor screenshot',
        );
        const gmReconnect = gm.waitForResponse(
            (r) => r.url().includes('/api/scenes/5/snapshot') && r.status() === 200,
        );
        const playerReconnect = player.waitForResponse(
            (r) => r.url().includes('/api/scenes/5/snapshot') && r.status() === 200,
        );
        await gm.evaluate(() => window.__mapQaDisconnect());
        await player.evaluate(() => window.__mapQaDisconnect());
        await Promise.all([gmReconnect, playerReconnect]);
        await settle(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        const eventCount = received.length;
        await stroke(gm, [panned(at(left, bottom - 120)), panned(at(left + 160, bottom - 180))]);
        await settle(gm);
        assert.ok(received.length > eventCount, 'Player receives terrain events after reconnect');
        await history(gm);
        assert.deepEqual(hashes(await snapshot(gm)), mixed);
        await gm.getByRole('button', { name: 'Закрыть редактор карты', exact: true }).click();
        await gm.locator('.active-tool-label').filter({ hasText: 'Выбор' }).waitFor();
        if (process.env.YTT_LONG_STROKE) {
            const duration = process.env.YTT_LONG_STROKE === '120' ? 120000 : 65000;
            const jitter = process.env.YTT_LONG_STROKE === 'jitter';
            const original = mapState(await snapshot(gm));
            const larger = { ...original, width: 5200, height: 3000 };
            assert.equal(
                (
                    await api(gm, '/scenes/5/map-world', 'POST', {
                        expected: original,
                        value: larger,
                    })
                ).status,
                200,
            );
            await gm.reload();
            await gm.locator('.canvas-host canvas').waitFor();
            await editor(gm);
            await gm.getByRole('button', { name: 'Рисовать: MAP-03A Meadow', exact: true }).click();
            await slider(gm, 'Размер кисти', 1024);
            await slider(gm, 'Мягкость', 110);
            await slider(gm, 'Непрозрачность', 180);
            await gm.getByRole('button', { name: 'Показать карту целиком', exact: true }).click();
            const canvas = await gm.locator('.canvas-host canvas').boundingBox();
            const point = (x, y) => [canvas.x + canvas.width * x, canvas.y + canvas.height * y];
            const route = [
                [0.18, 0.45],
                [0.36, 0.52],
                [0.62, 0.42],
                [0.8, 0.58],
                [0.64, 0.67],
                [0.35, 0.61],
            ];
            const variedRoute = [];
            if (jitter) {
                const zoom = Math.min(
                    (canvas.width - 32) / larger.width,
                    (canvas.height - 32) / larger.height,
                    1.2,
                );
                let last;
                for (let i = 0; i < 3600; i++) {
                    const t = 18.5 + i / 8;
                    const x =
                        Math.round(
                            (2600 + 1500 * Math.cos(t * 0.17) + 12 * Math.sin(t * 2.7)) * 4,
                        ) / 4;
                    const y =
                        Math.round(
                            (1500 + 850 * Math.sin(t * 0.17) + 12 * Math.cos(t * 2.13)) * 4,
                        ) / 4;
                    if (last && Math.hypot(last.x - x, last.y - y) < 1024 / 12) continue;
                    last = { x, y };
                    variedRoute.push([
                        0.5 + ((x - larger.width / 2) * zoom) / canvas.width,
                        0.5 + ((y - larger.height / 2) * zoom) / canvas.height,
                    ]);
                }
            }
            const before = hashes(await snapshot(gm));
            const count = report.strokes.length;
            const request = gm.waitForResponse(
                (r) => r.url().endsWith('/api/scenes/5/terrain') && r.request().method() === 'POST',
                { timeout: duration + 35000 },
            );
            await gm.evaluate(() => {
                window.__terrainLongFrames = [];
            });
            await gm.mouse.move(...point(...(jitter ? variedRoute[0] : route[0])));
            await gm.mouse.down();
            const start = Date.now();
            let moves = 0;
            if (jitter) {
                for (const p of variedRoute.slice(1)) {
                    const target = start + (++moves * duration) / (variedRoute.length - 1);
                    await gm.mouse.move(...point(...p));
                    if (moves === 180)
                        await gm.screenshot({ path: path.join(out, 'long-stroke-preview.png') });
                    if (Date.now() < target) await gm.waitForTimeout(target - Date.now());
                }
            } else {
                while (Date.now() - start < duration) {
                    await gm.mouse.move(...point(...route[++moves % route.length]), { steps: 8 });
                    if (moves === route.length * 3)
                        await gm.screenshot({ path: path.join(out, 'long-stroke-preview.png') });
                    await gm.waitForTimeout(125);
                }
            }
            assert.equal(report.strokes.length, count);
            const elapsed = Date.now() - start;
            const frameTimes = await gm.evaluate(() => {
                const frames = window.__terrainLongFrames.sort((a, b) => a - b);
                delete window.__terrainLongFrames;
                return {
                    median: frames[Math.floor(frames.length * 0.5)],
                    p95: frames[Math.floor(frames.length * 0.95)],
                    max: frames.at(-1),
                };
            });
            const released = Date.now();
            await gm.mouse.up();
            const r = await request;
            const releaseToResponseMs = Date.now() - released;
            assert.equal(r.status(), 200, JSON.stringify(await r.json()));
            const result = await r.json();
            assert.ok(result.terrain.chunks.length > 32);
            assert.ok(r.request().postDataJSON().points.length > 512);
            assert.equal(await gm.getByText(/Достигнут предел|Мазок слишком длинный/).count(), 0);
            await gm.locator('.map-editor-status .save-saved').waitFor();
            const after = hashes(await snapshot(gm));
            await history(gm);
            assert.deepEqual(hashes(await snapshot(gm)), before);
            await history(gm, true);
            assert.deepEqual(hashes(await snapshot(gm)), after);
            await gm.screenshot({ path: path.join(out, 'long-stroke-saved.png') });
            const stale = await api(gm, '/scenes/5/terrain', 'POST', r.request().postDataJSON());
            assert.equal(stale.status, 409);
            assert.deepEqual(hashes(await snapshot(gm)), after);
            await player.reload();
            await player.locator('.canvas-host canvas').waitFor();
            assert.deepEqual(hashes(await snapshot(player)), after);
            await settle(player);
            await player.screenshot({ path: path.join(out, 'long-stroke-player.png') });
            report.longStroke = {
                elapsed,
                releaseToResponseMs,
                moves,
                chunks: result.terrain.chunks.length,
                points: r.request().postDataJSON().points.length,
                frames: frameTimes,
                staleStatus: stale.status,
                route: jitter ? 'varied curved retraces' : 'zigzag retraces',
            };
            report.checks.push(
                'Held pointer, 1024 wu soft brush, one save, >512 points and >32 chunks, exact Undo/Redo, stale write rejected and Player reload matched hashes',
            );
        }
        await gm.goto(base + '/campaigns/5/scenes/5?mode=session');
        await gm.locator('.workspace.session-mode').waitFor();
        await settle(gm);
        assert.equal(await gm.getByRole('complementary', { name: 'Terrain Painter' }).count(), 0);
        await gm.screenshot({ path: path.join(out, 'terrain-session.png') });
        assert.ok(received.length > 0);
        assert.equal(JSON.stringify(received).includes('terrainEdit'), false);
        assert.equal(JSON.stringify(received).includes('layers'), false);
        assert.equal((await api(player, `/assets/${assets[0]}`)).status, 200);
        report.checks.push(
            'Reload restores hashes and supports new editable strokes; reconnect and Session preserve terrain; WebSocket contains only manifests',
        );
        assert.deepEqual(report.errors, []);
    } finally {
        try {
            if (gm && baseline) {
                for (const edit of edits.reverse()) {
                    const current = hashes(await snapshot(gm));
                    if (
                        !Object.entries(edit.after.hashes).every(
                            ([k, v]) => (current[k] ?? null) === v,
                        )
                    )
                        continue;
                    const r = await api(gm, '/scenes/5/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'terrain',
                                id: '5',
                                expected: edit.after.hashes,
                                value: { snapshot: edit.before.snapshot },
                            },
                        ],
                    });
                    assert.equal(r.status, 200, 'Restore terrain: ' + JSON.stringify(r.data));
                }
                assert.deepEqual(hashes(await snapshot(gm)), hashes(baseline));
                const current = mapState(await snapshot(gm)),
                    original = mapState(baseline);
                const restore = original.enabled
                    ? await api(gm, '/scenes/5/map-world', 'POST', {
                          expected: current,
                          value: original,
                      })
                    : await api(gm, '/scenes/5/edit-history', 'POST', {
                          changes: [
                              { kind: 'mapWorld', id: '5', expected: current, value: original },
                          ],
                      });
                assert.equal(restore.status, 200);
                for (const material of materials)
                    assert.equal(
                        (await api(gm, `/library/materials/${material.id}`, 'DELETE')).status,
                        200,
                    );
                for (const asset of assets)
                    assert.equal((await api(gm, `/assets/${asset}`, 'DELETE')).status, 200);
                const restored = await snapshot(gm);
                assert.deepEqual(restored.tokens, baseline.tokens);
                assert.deepEqual(restored.props, baseline.props);
                assert.deepEqual(restored.combat, baseline.combat);
                report.restored = true;
            }
        } finally {
            fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
            console.log(JSON.stringify(report, null, 2));
            await browser.close();
        }
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
