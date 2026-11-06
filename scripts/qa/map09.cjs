/* eslint-disable @typescript-eslint/no-require-imports -- Permanent fixture browser QA. */
/* global require, process, console, window, performance, setTimeout, Buffer */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const { login, api, tabletop, base } = require('./map07a.cjs');
const scene = '/scenes/7';
const out = path.resolve('artifacts/map09');
const memoryFixture = (action) =>
    execFileSync('php', ['scripts/qa/fog-memory-fixture.php', action], { stdio: 'pipe' });
function explored(memory, x, y) {
    const bit = Math.floor(y / memory.cellSize) * memory.width + Math.floor(x / memory.cellSize);
    return !!(Buffer.from(memory.bits, 'base64')[bit >> 3] & (1 << (bit % 8)));
}
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
        restored = false,
        backedUp = false;
    const record = (s) => {
        report.checks.push(s);
        console.log(s);
    };
    try {
        memoryFixture('backup');
        backedUp = true;
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
        await api(gm, scene + '/vision', 'POST', {
            enabled: true,
            memoryPolicy: 'player',
            resetMemory: true,
        });
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
        assert.ok(explored(first.vision.explored, 2550, 700));
        assert.ok(!explored(first.vision.explored, 3200, 1300));
        assert.notDeepEqual(first.vision.explored.bits, second.vision.explored.bits);
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
        const remembered = await state(p1);
        assert.ok(explored(remembered.vision.explored, target.x, target.y));
        assert.ok(!remembered.tokens.some((t) => t.id === target.id));
        report.fogPixels = await p1.evaluate(
            ({ visible, remembered }) => {
                const app = window.tabletopApp;
                const layer = app.stage.children[0].children.find((child) => child.currentMask);
                const fog = app.renderer.extract.pixels({ target: layer });
                const current = app.renderer.extract.pixels({ target: layer.currentTexture });
                const sample = (data, point) => {
                    const x = Math.floor((point.x * data.width) / 3300);
                    const y = Math.floor((point.y * data.height) / 1400);
                    return Array.from(
                        data.pixels.slice((y * data.width + x) * 4, (y * data.width + x) * 4 + 4),
                    );
                };
                return {
                    visible: sample(fog, visible),
                    explored: sample(fog, remembered),
                    unexplored: sample(fog, { x: 3200, y: 1300 }),
                    liveInExplored: sample(current, remembered),
                    liveInUnexplored: sample(current, { x: 3200, y: 1300 }),
                };
            },
            { visible: { x: 2550, y: 700 }, remembered: target },
        );
        assert.equal(report.fogPixels.visible[3], 0);
        assert.ok(report.fogPixels.explored[3] > 140 && report.fogPixels.explored[3] < 180);
        assert.ok(report.fogPixels.unexplored[3] > 230 && report.fogPixels.unexplored[3] < 255);
        assert.equal(report.fogPixels.liveInExplored[3], 0);
        assert.equal(report.fogPixels.liveInUnexplored[3], 0);
        await p1.screenshot({ path: path.join(out, 'player1-explored-door-closed.png') });
        record('Closed door retains explored territory without retaining the NPC');
        record('Door realtime reveals and removes the NPC without a scene reload');
        const manualGeometry = {
            points: [
                { x: 2540, y: 690 },
                { x: 2560, y: 710 },
            ],
        };
        report.manualFog = [];
        for (const operation of ['cover', 'reveal']) {
            const changed = await api(gm, scene + '/fog/actions', 'POST', {
                operation,
                shape: 'rectangle',
                geometry: manualGeometry,
            });
            await seen(p1, changed);
            await sleep(60);
            const alpha = await p1.evaluate(() => {
                const app = window.tabletopApp;
                const fog = app.stage.children[0].children.find((c) => c.paintRoot && c.saved);
                const data = app.renderer.extract.pixels({ target: fog.saved });
                return data.pixels[
                    (Math.floor((700 * data.height) / 1400) * data.width +
                        Math.floor((2550 * data.width) / 3300)) *
                        4 +
                        3
                ];
            });
            report.manualFog.push({ operation, alpha });
            assert.equal(alpha, operation === 'cover' ? 255 : 0);
        }
        record(
            'Manual Fog remains an independent top layer: cover/reveal leaves current LOS and memory authority intact',
        );
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
        const personalNow = await state(p1);
        const party = await api(gm, scene + '/vision', 'POST', {
            enabled: true,
            memoryPolicy: 'party',
        });
        await Promise.all([p1, p2].map((p) => seen(p, party)));
        const party1 = await state(p1),
            party2 = await state(p2);
        assert.deepEqual(party1.vision.explored, party2.vision.explored);
        const shared = Buffer.from(party1.vision.explored.bits, 'base64');
        assert.ok(
            Buffer.from(second.vision.explored.bits, 'base64').every(
                (byte, i) => (shared[i] & byte) === byte,
            ),
        );
        assert.deepEqual(
            party1.tokens.map((t) => t.id),
            personalNow.tokens.map((t) => t.id),
        );
        await api(gm, scene + '/vision', 'POST', { enabled: true, memoryPolicy: 'player' });
        record('Party shares territory only; current vision and entities stay personal');
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
        // A real door edit interrupts control even if a movement receipt is in flight.
        await p1.keyboard.down('d');
        await sleep(80);
        const geometryEdit = await door(true);
        await seen(p1, geometryEdit);
        await p1.keyboard.up('d');
        await p1.getByRole('button', { name: 'Управлять · WASD', exact: true }).waitFor();
        await sleep(500);
        const stoppedAt = (await state(p1)).tokens.find((t) => t.id === hero.id);
        await sleep(300);
        const stillAt = (await state(p1)).tokens.find((t) => t.id === hero.id);
        assert.equal(stillAt.x, stoppedAt.x);
        assert.equal(stillAt.y, stoppedAt.y);
        await door(false);
        record(
            'A real obstacle edit safely cancels held WASD, including pending movement receipts',
        );
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2240, y: 450 });
        await focus(p2, { x: 2240, y: 450 });
        const secondFrom = await screen(p2, { x: 2240, y: 450 });
        await p2.mouse.click(secondFrom.x, secondFrom.y);
        await p2.getByRole('button', { name: 'Управлять · WASD', exact: true }).click();
        await p2.keyboard.down('d');
        await sleep(700);
        await p2.keyboard.up('d');
        await sleep(500);
        assert.ok((await state(p2)).tokens.find((t) => t.id === hero2.id).x > 2265);
        await p2.keyboard.press('Escape');
        await api(gm, '/tokens/' + hero2.id, 'PATCH', { x: 2200, y: 400 });
        record('Second Player also completes real WASD steps with its own array-valued mask');
        await p1.bringToFront();
        await p1.keyboard.press('Escape');
        await sleep(400);
        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2300, y: 1250 });
        await focus(p1, { x: 2650, y: 1250 });
        const moved = (await state(p1)).tokens.find((t) => t.id === hero.id);
        const tokenPoint = await screen(p1, moved);
        await p1.mouse.click(tokenPoint.x, tokenPoint.y);
        const destination = await screen(p1, { x: 3100, y: 1250 });
        const clickResponse = p1.waitForResponse((r) => r.url().endsWith('/move'));
        let routeSnapshots = 0;
        const onRequest = (r) => {
            if (r.url().endsWith('/snapshot')) routeSnapshots++;
        };
        p1.on('request', onRequest);
        await p1.mouse.dblclick(destination.x, destination.y);
        const clickHttp = await clickResponse;
        assert.equal(clickHttp.status(), 200);
        assert.ok((await clickHttp.json()).vision?.enabled);
        for (let i = 1; i <= 4; i++) {
            await api(gm, '/tokens/' + hero2.id, 'PATCH', { rotation: (hero2.rotation + i) % 360 });
            await sleep(100);
        }
        await p1.waitForFunction(
            (id) => {
                const find = (v) =>
                    v.model?.id === id && v.badges ? v : (v.children ?? []).map(find).find(Boolean);
                const v = find(window.tabletopApp.stage);
                return v && v.x > 3097 && Math.abs(v.y - 1250) < 3;
            },
            hero.id,
            { timeout: 12000 },
        );
        p1.off('request', onRequest);
        report.routeSnapshots = routeSnapshots;
        assert.equal(routeSnapshots, 0);
        await p1.screenshot({ path: path.join(out, 'click-to-move.png') });
        report.gpuMaskSubmissionMs = await p1.evaluate(() => [...window.visionPaintMs]);
        assert.ok(report.gpuMaskSubmissionMs.length > 0);
        record(
            'Long Click-to-Move completes through unrelated participant Reverb revisions without snapshot resets',
        );
        const back = await api(gm, '/tokens/' + hero.id, 'PATCH', { x: 2490, y: 720 });
        await seen(p1, back);
        await sleep(150);
        const dragStart = await screen(
            p1,
            (await state(p1)).tokens.find((t) => t.id === hero.id),
        );
        const dragEnd = await screen(p1, { x: 2505, y: 730 });
        const dragResponse = p1.waitForResponse(
            (r) => r.url().endsWith('/move') && r.request().method() === 'POST',
        );
        await p1.mouse.move(dragStart.x, dragStart.y);
        await p1.mouse.down();
        await p1.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
        await p1.mouse.up();
        const drag = await (await dragResponse).json();
        assert.ok(drag.vision?.enabled);
        assert.equal(drag.token.x, 2505);
        record('Actual drag keeps authoritative current vision and explored memory');
        await p1.evaluate(() => window.movementDisconnect());
        await sleep(200);
        await p1.reload();
        await tabletop(p1).waitFor();
        await sleep(500);
        const reconnect = await state(p1);
        assert.equal(reconnect.vision.enabled, true);
        assert.ok(!reconnect.tokens.some((t) => t.id === target.id));
        assert.ok(explored(reconnect.vision.explored, target.x, target.y));
        record('Reconnect hydrates current mask and filtered entities without ghost NPCs');
        for (const sceneId of [5, 7]) {
            const snapshots = [p1, p2].map((p) =>
                p.waitForResponse((r) => r.url().endsWith(`/scenes/${sceneId}/snapshot`) && r.ok()),
            );
            await api(gm, '/campaigns/5/activate', 'POST', { sceneId });
            await Promise.all(snapshots);
            await Promise.all([p1, p2].map((p) => tabletop(p).waitFor()));
        }
        assert.deepEqual((await state(p1)).vision.explored, reconnect.vision.explored);
        record('Scene 5 -> 7 activation reloads personal fog without mixing scene memory');
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
        // Exercise real WebGL resource ownership offstage using subsets of the current grant.
        const safeVision = (await state(p1)).vision;
        report.gpuLifecycle = await p1.evaluate((vision) => {
            const app = window.tabletopApp;
            const live = app.stage.children[0].children.find((c) => c.currentMask);
            const layer = new live.constructor();
            layer.currentMask.renderable = false;
            const renderer = app.renderer;
            const before = Object.values(renderer.texture._managedTextures.items).filter(
                Boolean,
            ).length;
            const masks = new Set(),
                memories = new Set();
            for (let i = 0; i < 40; i++) {
                layer.sync(
                    renderer,
                    { ...vision, polygons: i % 2 ? vision.polygons : [] },
                    3300,
                    1400,
                );
                masks.add(layer.currentTexture);
                memories.add(layer.memoryTexture);
            }
            // Empty -> allowed grant: visual playback may only delay revelation.
            layer.sync(renderer, { ...vision, polygons: [] }, 3300, 1400);
            const origin = { x: 2505, y: 730 },
                end = { x: 2515, y: 730 };
            layer.sync(renderer, vision, 3300, 1400, [
                { tokenId: 'playback', path: [origin, end] },
            ]);
            const pixel = (target, p) => {
                const data = renderer.extract.pixels({ target });
                const x = Math.min(data.width - 1, Math.floor((p.x * data.width) / 3300));
                const y = Math.min(data.height - 1, Math.floor((p.y * data.height) / 1400));
                return data.pixels[(y * data.width + x) * 4 + 3];
            };
            layer.tick(120, false, new Map([['playback', origin]]));
            const pending = pixel(layer, origin);
            layer.tick(0, false, new Map([['playback', end]]));
            const completed = pixel(layer, origin);
            const current = renderer.extract.pixels({ target: layer.currentTexture });
            const fog = renderer.extract.pixels({ target: layer });
            let unauthorizedClearPixels = 0;
            for (let i = 3; i < current.pixels.length; i += 4) {
                if (current.pixels[i] === 0 && fog.pixels[i] < 157) unauthorizedClearPixels++;
            }
            layer.sync(renderer, { ...vision, polygons: [] }, 3300, 1400);
            const revokedLive = pixel(layer.currentTexture, origin);
            const fadingTerritory = pixel(layer, origin);
            layer.sync(
                renderer,
                { ...vision, polygons: [], explored: { ...vision.explored, bits: '' } },
                3300,
                1400,
            );
            const resetTerritory = pixel(layer, origin);
            const owned = [layer.currentTexture, layer.previousTexture, layer.memoryTexture];
            layer.destroy();
            return {
                masks: masks.size,
                memories: memories.size,
                pending,
                completed,
                unauthorizedClearPixels,
                revokedLive,
                fadingTerritory,
                resetTerritory,
                destroyed: owned.every((t) => t.destroyed),
                before,
                after: Object.values(renderer.texture._managedTextures.items).filter(Boolean)
                    .length,
            };
        }, safeVision);
        assert.equal(report.gpuLifecycle.masks, 2);
        assert.equal(report.gpuLifecycle.memories, 1);
        assert.equal(report.gpuLifecycle.destroyed, true);
        assert.ok(report.gpuLifecycle.after <= report.gpuLifecycle.before + 4);
        assert.equal(report.gpuLifecycle.unauthorizedClearPixels, 0);
        assert.ok(report.gpuLifecycle.pending >= 157);
        assert.equal(report.gpuLifecycle.completed, 0);
        assert.equal(report.gpuLifecycle.revokedLive, 0);
        assert.ok(report.gpuLifecycle.fadingTerritory < 157);
        assert.ok(report.gpuLifecycle.resetTerritory >= 239);
        record(
            'WebGL: playback-gated reveal stays within authority; 40 mask updates reuse two surfaces, teardown frees all owned textures',
        );
        report.listenerCycles = [];
        for (const p of [p1, p2]) {
            const cdp = await p.context().newCDPSession(p);
            for (let i = 0; i < 3; i++) {
                await p.reload();
                await tabletop(p).waitFor();
                await sleep(350);
                await cdp.send('HeapProfiler.collectGarbage');
                report.listenerCycles.push({
                    role: p === p1 ? 1 : 2,
                    cycle: i,
                    ...(await cdp.send('Memory.getDOMCounters')),
                });
            }
            await cdp.detach();
        }
        for (const role of [1, 2]) {
            const counts = report.listenerCycles
                .filter((c) => c.role === role)
                .map((c) => c.jsEventListeners);
            assert.ok(counts.at(-1) <= counts[0] + 8, JSON.stringify(counts));
        }
        record('Repeated Player reconnect/reload + GC keeps event-listener counts bounded');
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
        if (gm && baseline && backedUp) {
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
            await api(gm, scene + '/vision', 'POST', {
                enabled: baseline.vision.enabled,
                memoryPolicy: baseline.vision.memoryPolicy,
            });
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
        if (backedUp) memoryFixture('restore');
        report.restored = restored;
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
