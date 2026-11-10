/* eslint-disable @typescript-eslint/no-require-imports -- Scene 7 Chromium QA. */
/* global require, process, console, window, requestAnimationFrame, Buffer */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, tabletop, base, subscribed } = require('./map07a.cjs');
const { align: alignMap } = require('./builder06.cjs');

const scene = '/scenes/7';
const campaign = '/campaigns/5';
const out = 'artifacts/fog-ux-01';
const state = (page) => api(page, scene + '/snapshot');
const memory = (action) => execFileSync('php', ['scripts/qa/fog-memory-fixture.php', action]);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const gmPath = (mode) => base + '/campaigns/5/scenes/7?mode=' + mode;
const playerPath = base + '/campaigns/5/play';
const camera = (page) =>
    page.evaluate(() => {
        const world = window.tabletopApp.stage.children[0];
        return { x: world.x, y: world.y, zoom: world.scale.x };
    });
const ready = async (page) => {
    await tabletop(page).waitFor();
    await subscribed(page);
    await page.locator('.scene-title-arrival').waitFor({ state: 'hidden' });
};
async function screen(page, [x, y]) {
    const c = await camera(page),
        b = await tabletop(page).boundingBox();
    return [b.x + c.x + x * c.zoom, b.y + c.y + y * c.zoom];
}
async function align(page, zoom, point) {
    await tabletop(page).focus();
    await alignMap(page, zoom, point);
}
async function stroke(page, a, b, cancel = false) {
    const start = await screen(page, a),
        end = await screen(page, b);
    const response = cancel
        ? null
        : page.waitForResponse(
              (r) => r.url().endsWith(scene + '/fog/actions') && r.request().method() === 'POST',
              { timeout: 12000 },
          );
    await page.mouse.move(...start);
    await page.mouse.down();
    await page.mouse.move(...end, { steps: 16 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    if (response) {
        const result = await response;
        assert.equal(result.status(), 200);
        return result.json();
    }
}
const layerPixel = (page, point, kind) =>
    page.evaluate(
        ({ point, kind }) => {
            const app = window.tabletopApp;
            const layers = app.stage.children[0].children;
            const layer =
                kind === 'manual'
                    ? layers.find((child) => child.paintRoot)
                    : layers.find((child) => child.currentMask);
            const target = kind === 'manual' ? layer.texture : layer.currentMask.texture;
            const result = app.renderer.extract.pixels({ target });
            const scene = layers.find((child) => child.paintRoot);
            const offset =
                (Math.floor((point[1] * result.height) / scene.h) * result.width +
                    Math.floor((point[0] * result.width) / scene.w)) *
                4;
            return Array.from(result.pixels.slice(offset, offset + 4));
        },
        { point, kind },
    );
async function waitPixel(page, point, expected) {
    const stop = Date.now() + 4000;
    let actual;
    do {
        actual = await layerPixel(page, point, 'manual');
        if (JSON.stringify(actual) === JSON.stringify(expected)) return;
        await page.waitForTimeout(80);
    } while (Date.now() < stop);
    assert.deepEqual(actual, expected);
}
const frameStats = (page, duration) =>
    page.evaluate(
        (duration) =>
            new Promise((resolve) => {
                const times = [];
                let start, last;
                const tick = (now) => {
                    if (start === undefined) start = last = now;
                    else {
                        times.push(now - last);
                        last = now;
                    }
                    if (now - start < duration) requestAnimationFrame(tick);
                    else {
                        times.sort((a, b) => a - b);
                        resolve({
                            fps: Math.round((times.length * 1000) / (now - start)),
                            p95ms: Math.round(times[Math.floor(times.length * 0.95)]),
                        });
                    }
                };
                requestAnimationFrame(tick);
            }),
        duration,
    );
async function waitDelta(page, revision, field) {
    await page.waitForFunction(
        ({ revision, field }) =>
            window.movementFrames.some((raw) => {
                const frame = JSON.parse(raw);
                if (frame.event !== 'tabletop') return false;
                const data = JSON.parse(frame.data);
                const envelope = data.envelope ?? data;
                return envelope.revision === revision && field in (envelope.payload ?? {});
            }),
        { revision, field },
    );
}
async function history(page, redo = false) {
    const response = page.waitForResponse(
        (r) => r.url().endsWith('/edit-history') && r.request().method() === 'POST',
    );
    await button(page, redo ? 'Повторить правку' : 'Отменить правку').click();
    const result = await response;
    assert.equal(result.status(), 200);
    return result.json();
}
function explored(snapshot, [x, y]) {
    const m = snapshot.vision.explored;
    const index = Math.floor(y / m.cellSize) * m.width + Math.floor(x / m.cellSize);
    return (Buffer.from(m.bits, 'base64')[Math.floor(index / 8)] & (1 << (index % 8))) !== 0;
}

(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const report = { scene: 7, checks: [], errors: [], restored: false };
    let gm,
        baseline,
        originalActive,
        backed = false;
    const check = (line) => {
        report.checks.push(line);
        console.log(line);
    };
    const light = async (value) =>
        api(gm, scene + '/lighting', 'PUT', { value, expected: (await state(gm)).lighting });
    const door = async (value) =>
        api(gm, scene + '/structure', 'POST', {
            door: { id: 'los-corridor-door', open: value },
            expected: (await state(gm)).structure.hash,
        });
    try {
        memory('backup');
        backed = true;
        const pages = await Promise.all(
            [1, 2, 8].map((id) =>
                login(
                    browser,
                    accounts.find((a) => a.id === id),
                    {
                        viewport: { width: 1440, height: 900 },
                        reducedMotion: 'reduce',
                    },
                ),
            ),
        );
        [gm] = pages;
        const [, p1, p2] = pages;
        for (const page of pages)
            page.on('pageerror', (error) => report.errors.push(error.message));
        originalActive = (await api(gm, campaign)).activeSceneId;
        assert.notEqual(
            originalActive,
            '5',
            'Scene 5 is excluded from QA; activate Scene 7 first.',
        );
        baseline = await state(gm);
        const hero = baseline.tokens.find(
            (token) => token.ownerUserId === '2' && token.kind === 'player_character',
        );
        const corridorDoor = baseline.structure.graph.openings.find(
            ({ id }) => id === 'los-corridor-door',
        );
        const doorTarget = baseline.tokens.find((token) => token.name === 'LOS · за дверью');
        const secrets = baseline.tokens.filter((token) => token.isHidden).map(({ id }) => id);
        const privateProps = baseline.props.filter((prop) => prop.isHidden).map(({ id }) => id);
        assert.ok(hero, 'Expected the existing Player 1 hero.');
        assert.ok(corridorDoor && doorTarget, 'Expected the existing LOS corridor.');
        assert.ok(
            secrets.length || privateProps.length,
            'Expected an existing hidden token or prop.',
        );
        if (originalActive !== '7') await api(gm, campaign + '/activate', 'POST', { sceneId: 7 });
        await api(gm, scene + '/vision', 'POST', { enabled: true, memoryPolicy: 'player' });
        await api(gm, scene + '/fog/reset', 'POST', { base: 'clear' });
        await light({ ...baseline.lighting, enabled: true, mode: 'day', brightness: 0.88 });
        await Promise.all([gm.goto(gmPath('prepare')), p1.goto(playerPath), p2.goto(playerPath)]);
        await Promise.all(pages.map(ready));

        await button(gm, 'Редактировать карту').click();
        const beforeMode = await camera(gm);
        const box = await tabletop(gm).boundingBox();
        await button(gm, 'Туман').click();
        assert.deepEqual(await camera(gm), beforeMode);
        assert.deepEqual(await tabletop(gm).boundingBox(), box);
        await gm.getByRole('checkbox', { name: 'Автообзор игрока' }).check();
        await gm.getByLabel('Игрок для автообзора').waitFor();
        await gm.getByLabel('Игрок для автообзора').selectOption('2');
        await gm.getByLabel('Диаметр кисти').fill('65');
        await align(gm, 0.64, [hero.x, hero.y]);
        const a = [hero.x - 50, hero.y],
            b = [hero.x + 55, hero.y + 25],
            point = [hero.x, hero.y];
        const before = await state(gm);
        await stroke(gm, a, b, true);
        assert.equal((await state(gm)).revision, before.revision);
        await gm.bringToFront();
        report.idle = await frameStats(gm, 700);
        const covered = await stroke(gm, a, b);
        assert.equal(covered.fogAction.operation, 'cover');
        assert.ok(covered.fogAction.geometry.points.length > 2);
        assert.ok(Math.abs(covered.fogAction.geometry.points[0].x - a[0]) < 2);
        await Promise.all([
            waitDelta(p1, covered.revision, 'fogAction'),
            waitDelta(p2, covered.revision, 'fogAction'),
        ]);
        await waitPixel(p1, point, [0, 0, 0, 255]);
        await gm.screenshot({ path: out + '/gm-editor-brush.png' });
        await button(gm, 'Стереть').click();
        const erased = await stroke(gm, a, b);
        await waitDelta(p1, erased.revision, 'fogAction');
        await waitPixel(p1, point, [0, 0, 0, 0]);
        check(
            'Editor brush: world coordinates after zoom and pan, Escape, cover and erase over current vision',
        );
        const undo = await history(gm);
        await waitDelta(p1, undo.revision, 'fogRemovedSequence');
        await waitPixel(p1, point, [0, 0, 0, 255]);
        const redo = await history(gm, true);
        await waitDelta(p1, redo.revision, 'fogAction');
        await waitPixel(p1, point, [0, 0, 0, 0]);

        await button(gm, 'Прямоугольник').click();
        const beforePlayer = await state(p1);
        const target = [doorTarget.x, doorTarget.y];
        await align(gm, 0.68, target);
        const rectA = [target[0] - 145, target[1] - 115],
            rectB = [target[0] + 115, target[1] + 115];
        const currentBefore = await layerPixel(p1, target, 'current');
        assert.equal(currentBefore[3], 0, 'The test rectangle should be outside current vision.');
        await button(gm, 'Скрыть').click();
        const rectangle = await stroke(gm, rectA, rectB);
        await waitDelta(p1, rectangle.revision, 'fogAction');
        await waitPixel(p1, target, [0, 0, 0, 255]);
        await button(gm, 'Раскрыть').click();
        const revealed = await stroke(gm, rectA, rectB);
        await Promise.all([
            waitDelta(p1, revealed.revision, 'fogAction'),
            waitDelta(p2, revealed.revision, 'fogAction'),
        ]);
        for (const page of [p1, p2]) {
            await waitPixel(page, target, [255, 0, 0, 255]);
            const snapshot = await state(page);
            assert.ok(snapshot.tokens.every(({ id }) => !secrets.includes(id)));
            assert.ok(snapshot.props.every(({ id }) => !privateProps.includes(id)));
            assert.equal(await button(page, 'Fog tool').count(), 0);
        }
        assert.deepEqual(await layerPixel(p1, target, 'current'), currentBefore);
        assert.deepEqual((await state(p1)).vision, beforePlayer.vision);
        assert.ok(!(await state(p1)).tokens.some(({ id }) => id === doorTarget.id));
        report.doorTargetExploredAtStart = explored(beforePlayer, target);
        await gm.screenshot({ path: out + '/gm-editor-rectangle.png' });
        await align(p1, 0.68, target);
        await p1.screenshot({ path: out + '/player-1-reveal.png' });
        await align(p2, 0.68, target);
        await p2.screenshot({ path: out + '/player-2-reveal.png' });
        check(
            'Rectangle: hide/reveal in both players via Reverb; exact LOS and private tokens unaffected',
        );

        await door(!corridorDoor.open);
        await door(corridorDoor.open);
        const lighting = baseline.lighting;
        await light(lighting);
        const priorMove = (await state(p1)).vision;
        const movement = await api(p1, '/tokens/' + hero.id + '/move', 'POST', {
            x: hero.x + 45,
            y: hero.y,
            instant: true,
        });
        assert.notEqual(movement.token?.x, hero.x);
        const moved = await state(p1);
        assert.notDeepEqual(moved.vision, priorMove);
        assert.equal(moved.fog.actions.at(-1).operation, 'explore');
        await api(gm, '/tokens/' + hero.id, 'PATCH', { x: hero.x, y: hero.y });
        await p1.reload();
        await ready(p1);
        await waitPixel(p1, target, [255, 0, 0, 255]);
        const subscriptions = await p2.evaluate(
            () =>
                window.movementFrames.filter((frame) => frame.includes('subscription_succeeded'))
                    .length,
        );
        await p2.evaluate(() => window.movementDisconnect());
        await p2.waitForFunction(
            (count) =>
                window.movementFrames.filter((frame) => frame.includes('subscription_succeeded'))
                    .length > count,
            subscriptions,
        );
        await waitPixel(p2, target, [255, 0, 0, 255]);
        check(
            'Door and lighting updates, movement, reload and WebSocket reconnection retain manual fog',
        );

        await gm.goto(gmPath('session'));
        await ready(gm);
        await align(gm, 0.64, point);
        const sessionCamera = await camera(gm),
            sessionBox = await tabletop(gm).boundingBox();
        await gm.keyboard.press('f');
        const panel = gm.getByRole('region', { name: 'Ручной туман' });
        await panel.waitFor();
        assert.equal(await button(panel, 'Прямоугольник').getAttribute('aria-pressed'), 'true');
        await button(panel, 'Кисть').click();
        assert.equal(await panel.getByLabel('Диаметр кисти').inputValue(), '65');
        await button(panel, 'Скрыть').click();
        const resources = () =>
            gm.evaluate(() => {
                const layer = window.tabletopApp.stage.children[0].children.find(
                    (child) => child.paintRoot,
                );
                return [layer.saved.uid, layer.preview.uid];
            });
        const textures = await resources();
        await gm.bringToFront();
        const start = await screen(gm, a),
            end = await screen(gm, b);
        await gm.mouse.move(...start);
        await gm.mouse.down();
        const stats = frameStats(gm, 950);
        for (let i = 0; i < 22; i++) {
            await gm.mouse.move(
                start[0] + ((end[0] - start[0]) * i) / 21,
                start[1] + Math.sin(i / 5) * 32,
            );
            await gm.waitForTimeout(24);
        }
        report.drawing = await stats;
        await gm.screenshot({ path: out + '/gm-session-preview.png' });
        await gm.keyboard.press('Escape');
        await gm.mouse.up();
        assert.deepEqual(await resources(), textures);
        await stroke(gm, a, b);
        assert.deepEqual(await camera(gm), sessionCamera);
        assert.deepEqual(await tabletop(gm).boundingBox(), sessionBox);
        const memoryBeforeReset = (await state(p1)).vision.explored;
        await button(panel, 'Сбросить ручной туман…').click();
        const resetResponse = gm.waitForResponse((r) => r.url().endsWith(scene + '/fog/reset'));
        await button(gm, 'Сбросить туман').click();
        const reset = await (await resetResponse).json();
        assert.deepEqual(reset.fog, { base: 'clear', actions: [] });
        const restoredFog = await history(gm);
        assert.ok(restoredFog.fog.actions.some(({ operation }) => operation === 'explore'));
        await waitPixel(p1, target, [255, 0, 0, 255]);
        assert.deepEqual((await state(p1)).vision.explored, memoryBeforeReset);
        await button(panel, 'Выйти из режима тумана').click();
        await panel.waitFor({ state: 'hidden' });
        check(
            'Session: quick entry/exit, camera and canvas stable, reset preserves explored memory, reusable GPU textures',
        );
        assert.deepEqual(report.errors, []);
    } finally {
        let restoredScene = false;
        try {
            if (gm && baseline) {
                const current = await state(gm);
                if (current.structure.hash !== baseline.structure.hash)
                    await api(gm, scene + '/structure', 'POST', {
                        value: baseline.structure.graph,
                        expected: current.structure.hash,
                    });
                if (JSON.stringify(current.lighting) !== JSON.stringify(baseline.lighting))
                    await light(baseline.lighting);
                for (const token of baseline.tokens) {
                    const actual = current.tokens.find(({ id }) => id === token.id);
                    if (actual.x !== token.x || actual.y !== token.y)
                        await api(gm, '/tokens/' + token.id, 'PATCH', { x: token.x, y: token.y });
                }
                if (JSON.stringify(current.vision) !== JSON.stringify(baseline.vision))
                    await api(gm, scene + '/vision', 'POST', {
                        enabled: baseline.vision.enabled,
                        memoryPolicy: baseline.vision.memoryPolicy,
                    });
                if (originalActive !== '7')
                    await api(gm, campaign + '/activate', 'POST', { sceneId: originalActive });
                assert.equal((await api(gm, campaign)).activeSceneId, originalActive);
                const restored = await state(gm);
                assert.equal(restored.structure.hash, baseline.structure.hash);
                assert.deepEqual(restored.lighting, baseline.lighting);
                assert.deepEqual(restored.vision, baseline.vision);
                assert.deepEqual(
                    restored.tokens.map(({ id, x, y }) => ({ id, x, y })),
                    baseline.tokens.map(({ id, x, y }) => ({ id, x, y })),
                );
            }
            restoredScene = true;
        } finally {
            await browser.close();
            if (backed) {
                memory('restore');
                report.restored = restoredScene;
            }
            fs.writeFileSync(out + '/report.json', JSON.stringify(report, null, 2));
        }
    }
})().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
});
