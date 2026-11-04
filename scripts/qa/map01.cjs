/* eslint-disable @typescript-eslint/no-require-imports -- Native local browser QA entrypoint. */
/* global require, __dirname, process, console, fetch, crypto, document, window, setTimeout */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const root = path.resolve(__dirname, '../..');
const base = 'http://localhost:8090';
const out = path.join(root, 'artifacts/map01');
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], restored: false, errors: [] };
const state = (s) => ({
    enabled: !!s.mapWorld,
    width: s.width,
    height: s.height,
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
    grid: s.grid,
});
const positions = (s) => ({
    tokens: s.tokens.map((t) => [t.id, t.x, t.y, t.scale]),
    props: (s.props ?? []).map((p) => [p.id, p.x, p.y, p.scaleX, p.scaleY]),
});
async function api(page, url, method = 'GET', body) {
    return page.evaluate(
        async ({ url, method, body }) => {
            const { csrf } = await (await fetch('/api/session')).json();
            const response = await fetch('/api' + url, {
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
            return { status: response.status, data: await response.json() };
        },
        { url, method, body },
    );
}
async function snapshot(page) {
    const r = await api(page, '/scenes/5/snapshot');
    assert.equal(r.status, 200);
    return r.data;
}
async function number(panel, label, value) {
    const input = panel.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press('Tab');
}
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, baseline;
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
                'utf8',
            ),
        );
        const pages = [];
        for (const id of [1, 2]) {
            const account = accounts.find((a) => a.id === id);
            const context = await browser.newContext({ viewport: { width: 1536, height: 1000 } });
            await context.addInitScript(() => {
                const Native = window.WebSocket;
                const sockets = new Set();
                window.WebSocket = class extends Native {
                    constructor(...args) {
                        super(...args);
                        sockets.add(this);
                        this.addEventListener('close', () => sockets.delete(this));
                    }
                };
                window.__mapQaDisconnect = () => sockets.forEach((socket) => socket.close());
            });
            const page = await context.newPage();
            page.on('pageerror', (e) => report.errors.push(e.message));
            await page.goto(base + '/login');
            await page.locator('input[type=email]').fill(account.email);
            await page.locator('input[name=password]').fill(account.password);
            await page.locator('form button.primary-button').click();
            await page.waitForURL((u) => !u.pathname.includes('login'));
            pages.push(page);
        }
        [gm] = pages;
        const player = pages[1];
        const playerUpdates = [];
        player.on('websocket', (socket) =>
            socket.on('framereceived', ({ payload }) => {
                try {
                    const frame = JSON.parse(String(payload));
                    const event =
                        typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    if (event?.type === 'map-world.updated') playerUpdates.push(event);
                } catch {
                    /* Pusher control frames carry no scene patch. */
                }
            }),
        );
        await gm.goto(base + '/campaigns/5/scenes');
        await gm.getByRole('link', { name: 'Открыть для подготовки', exact: true }).click();
        await gm.locator('.canvas-host canvas').waitFor();
        assert.equal(await gm.locator('canvas').count(), 1);
        baseline = await snapshot(gm);
        report.checks.push('Campaign → Scene → Preparation; one existing Pixi canvas');
        await player.goto(base + '/campaigns/5/play');
        await player.locator('.canvas-host canvas').waitFor();
        await gm
            .getByRole('button', {
                name: baseline.mapWorld ? 'Редактировать карту' : 'Создать редактируемую карту',
                exact: true,
            })
            .click();
        await gm.getByRole('button', { name: 'Настройки карты и сетки', exact: true }).click();
        let panel = gm.getByRole('complementary', { name: 'Подготовка карты', exact: true });
        await number(panel, 'Ширина мира', baseline.width + 120);
        await number(panel, 'Высота мира', baseline.height + 120);
        if (baseline.map) {
            await number(panel, 'Основа X', baseline.map.x + 20);
            await number(
                panel,
                'Масштаб основы, %',
                (baseline.map.width / baseline.map.asset.width) * 100 + 1,
            );
            await panel.getByText('Кадр и точные размеры', { exact: true }).click();
            await number(panel, 'Кадр ширина, %', 95);
        }
        await panel
            .getByRole('button', { name: 'Указать две точки на карте', exact: true })
            .click();
        const canvas = await gm.locator('.canvas-host canvas').boundingBox();
        await gm.mouse.click(canvas.x + 160, canvas.y + 240);
        await gm.mouse.click(canvas.x + 420, canvas.y + 240);
        await panel.getByText('Замерьте несколько клеток изображения.', { exact: false }).waitFor();
        const calibratedSize = Number(
            await panel.getByLabel('Размер клетки', { exact: true }).inputValue(),
        );
        assert.ok(calibratedSize >= 20 && calibratedSize <= 160);
        await gm.screenshot({ path: path.join(out, 'calibration.png') });
        await panel.evaluate((el) => {
            el.scrollTop = 0;
        });
        await gm.screenshot({ path: path.join(out, 'preparation.png') });
        await panel
            .getByRole('button', {
                name: baseline.mapWorld ? 'Сохранить карту' : 'Создать карту',
                exact: true,
            })
            .click();
        await panel.waitFor({ state: 'detached' });
        let saved = await snapshot(gm);
        assert.equal(saved.revision, baseline.revision + 1);
        assert.equal(saved.width, baseline.width + 120);
        assert.ok(saved.mapWorld);
        assert.ok(Math.abs(saved.grid.size - calibratedSize) < 0.02);
        for (let i = 0; i < 50 && !playerUpdates.length; i++)
            await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(playerUpdates.at(-1)?.payload.mapWorld.bounds.width, saved.width);
        if (baseline.map) {
            assert.equal(saved.map.x, baseline.map.x + 20);
            assert.equal(saved.map.crop.width, 0.95);
        }
        assert.deepEqual(positions(saved), positions(baseline));
        report.checks.push(
            'Atomic bounds/reference/crop/grid save; token/prop positions unchanged',
        );
        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        assert.deepEqual(state(await snapshot(gm)), state(saved));
        const resnapshot = gm.waitForResponse(
            (r) => r.url().endsWith('/api/scenes/5/snapshot') && r.status() === 200,
        );
        await gm.evaluate(() => window.__mapQaDisconnect());
        await resnapshot;
        await gm.locator('.connection-badge.connected').waitFor();
        await gm.getByRole('button', { name: 'Редактировать карту', exact: true }).click();
        await gm.getByRole('button', { name: 'Настройки карты и сетки', exact: true }).click();
        panel = gm.getByRole('complementary', { name: 'Подготовка карты', exact: true });
        await gm.waitForFunction(
            (w) =>
                document.querySelector('.map-preparation input[type=number]')?.value === String(w),
            saved.width,
        );
        await panel.getByRole('button', { name: 'Без изображения', exact: true }).click();
        await panel.getByRole('button', { name: 'Сохранить карту', exact: true }).click();
        await panel.waitFor({ state: 'detached' });
        saved = await snapshot(gm);
        assert.equal(saved.map, null);
        assert.ok(saved.mapWorld);
        report.checks.push('Reload/reconnect; blank editable world');
        const denied = await api(player, '/scenes/5/map-world', 'POST', {
            value: state(saved),
            expected: state(saved),
        });
        assert.equal(denied.status, 403);
        const playerSnapshot = await snapshot(player);
        assert.equal(playerSnapshot.mapWorld.bounds.width, saved.width);
        assert.equal(playerSnapshot.mapWorld.schemaVersion, undefined);
        report.checks.push('Player rendering projection; writes denied');
        await gm.goto(base + '/campaigns/5/scenes/5?mode=session');
        await gm.locator('.workspace.session-mode').waitFor();
        await gm.locator('.canvas-host canvas').waitFor();
        assert.equal(await gm.locator('canvas').count(), 1);
        assert.equal(
            await gm.getByRole('button', { name: 'Редактировать карту', exact: true }).count(),
            0,
        );
        report.checks.push('Existing Session opens with one canvas and no editor UI');
        await gm.goto(base + '/campaigns/5/scenes/5?mode=prepare');
        await gm.locator('.canvas-host canvas').waitFor();
        await gm.getByRole('button', { name: 'Редактировать карту', exact: true }).click();
        await gm.getByRole('button', { name: 'Настройки карты и сетки', exact: true }).click();
        await gm.setViewportSize({ width: 980, height: 800 });
        await gm.screenshot({ path: path.join(out, 'compact.png') });
        assert.deepEqual(positions(await snapshot(gm)), positions(baseline));
        assert.deepEqual(report.errors, []);
    } finally {
        if (gm && baseline) {
            const current = await snapshot(gm);
            const restored = await api(gm, '/scenes/5/edit-history', 'POST', {
                changes: [
                    { kind: 'mapWorld', id: '5', expected: state(current), value: state(baseline) },
                ],
            });
            assert.equal(restored.status, 200);
            const after = await snapshot(gm);
            assert.deepEqual(state(after), state(baseline));
            assert.deepEqual(positions(after), positions(baseline));
            report.restored = true;
        }
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        await browser.close();
    }
    console.log(JSON.stringify(report));
})().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
