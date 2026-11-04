/* eslint-disable @typescript-eslint/no-require-imports -- Native local QA. */
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
const root = path.resolve(__dirname, '../..'),
    base = 'http://localhost:8090';
const out = path.join(root, 'artifacts/map02');
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], errors: [], restored: false };
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
            return { status: r.status, data: await r.json() };
        },
        { url, method, body },
    );
}
async function snapshot(page) {
    const r = await api(page, '/scenes/5/snapshot');
    assert.equal(r.status, 200);
    return r.data;
}
async function saved(page) {
    await page.waitForFunction(
        () => document.querySelector('.save-saved') || document.querySelector('.save-state.saved'),
    );
}
async function number(panel, label, value) {
    const input = panel.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press('Tab');
}
async function until(fn) {
    for (let i = 0; i < 60; i++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 100));
    }
    throw Error('State did not converge');
}
async function chooseAsset(page, assetName) {
    const dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Поиск Assets').fill(assetName);
    await dialog.locator('.global-asset-card').filter({ hasText: assetName }).first().click();
    await dialog.getByRole('button', { name: 'Выбрать ресурс', exact: true }).click();
}
async function editor(page) {
    const close = page.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
    if (await close.isVisible()) await close.click();
    await page
        .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
        .click();
    await page.getByRole('toolbar', { name: 'Инструменты редактора карты' }).waitFor();
}
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, baseline, copiedAsset, materialId;
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
        await gm.goto(base + '/campaigns/5/scenes/5?mode=prepare');
        await gm.locator('.canvas-host canvas').waitFor();
        baseline = await snapshot(gm);
        const playerEvents = [];
        player.on('websocket', (socket) =>
            socket.on('framereceived', ({ payload }) => {
                try {
                    const frame = JSON.parse(String(payload));
                    const e = typeof frame.data === 'string' ? JSON.parse(frame.data) : frame.data;
                    if (e?.type === 'objects.changed') playerEvents.push(e);
                } catch {
                    /* protocol frame */
                }
            }),
        );
        await player.goto(base + '/campaigns/5/play');
        await player.locator('.canvas-host canvas').waitFor();
        // Ensure one private, personal texture for material authoring; remove it in finally.
        const source = baseline.props.find((p) => /^\d+$/.test(p.image.id));
        assert.ok(source);
        const copied = await api(gm, `/library/assets/${source.image.id}/duplicate`, 'POST');
        assert.equal(copied.status, 200);
        copiedAsset = copied.data;
        await editor(gm);
        assert.equal(await gm.locator('canvas').count(), 1);
        assert.equal(
            await player.getByRole('toolbar', { name: 'Инструменты редактора карты' }).count(),
            0,
        );
        const toolbar = gm.getByRole('toolbar', { name: 'Инструменты редактора карты' });
        await gm.screenshot({ path: path.join(out, 'editor.png') });
        report.checks.push(
            'Preparation opens Map Editor over one existing Pixi canvas; player has no editor',
        );
        await gm.getByRole('button', { name: 'Добавить объект из Assets', exact: true }).click();
        await chooseAsset(gm, copiedAsset.name);
        await gm.locator('.creation-placement-bar').waitFor();
        const canvas = await gm.locator('.canvas-host canvas').boundingBox();
        const at = { x: canvas.x + canvas.width * 0.46, y: canvas.y + canvas.height * 0.56 };
        await gm.mouse.move(at.x, at.y);
        await gm.mouse.click(at.x, at.y);
        await saved(gm);
        await gm.keyboard.press('Escape');
        const added = (await snapshot(gm)).props.filter(
            (p) => !baseline.props.some((old) => old.id === p.id),
        );
        assert.equal(added.length, 1);
        const id = added[0].id;
        // Escape clears selection. Clicking selects the newly placed prop without token actions.
        await gm.mouse.click(at.x, at.y);
        const inspector = gm.locator('.map-editor-prop');
        await inspector.waitFor();
        await number(inspector, 'Поворот', -35);
        await saved(gm);
        await number(inspector, 'Ширина', 180);
        await saved(gm);
        const validRevision = (await snapshot(gm)).revision;
        await number(inspector, 'Ширина', -5);
        await gm.locator('.map-editor-notice').waitFor();
        await saved(gm);
        assert.equal((await snapshot(gm)).revision, validRevision);
        await gm.getByRole('button', { name: 'Скрыть подсказку', exact: true }).click();
        assert.equal((await snapshot(gm)).props.find((p) => p.id === id).rotation, -35);
        const beforeDrag = (await snapshot(gm)).props.find((p) => p.id === id);
        await gm.mouse.move(at.x, at.y);
        await gm.mouse.down();
        await gm.mouse.move(at.x + 64, at.y + 48, { steps: 8 });
        await gm.mouse.up();
        await saved(gm);
        const moved = (await snapshot(gm)).props.find((p) => p.id === id);
        assert.notEqual(moved.x, beforeDrag.x);
        await toolbar.getByRole('button', { name: 'Отменить правку', exact: true }).click();
        await saved(gm);
        assert.equal((await snapshot(gm)).props.find((p) => p.id === id).x, beforeDrag.x);
        await toolbar.getByRole('button', { name: 'Повторить правку', exact: true }).click();
        await saved(gm);
        assert.equal((await snapshot(gm)).props.find((p) => p.id === id).x, moved.x);
        await gm.keyboard.press('Control+d');
        await saved(gm);
        assert.equal((await snapshot(gm)).props.length, baseline.props.length + 2);
        await toolbar.getByRole('button', { name: 'Отменить правку', exact: true }).click();
        await saved(gm);
        assert.equal((await snapshot(gm)).props.length, baseline.props.length + 1);
        // Undo duplication deselects its removed copy; reselect original at its dragged location.
        await gm.mouse.click(at.x + 64, at.y + 48);
        await gm.keyboard.press('Delete');
        await gm.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
        await saved(gm);
        assert.equal((await snapshot(gm)).props.length, baseline.props.length);
        await toolbar.getByRole('button', { name: 'Отменить правку', exact: true }).click();
        await saved(gm);
        assert.equal((await snapshot(gm)).props.length, baseline.props.length + 1);
        report.checks.push(
            'Global Assets → ghost placement; click selection, rotate, scale, drag/snap, duplicate/delete and Undo/Redo',
        );
        await toolbar.getByRole('button', { name: 'Слои редактора', exact: true }).click();
        const revision = (await snapshot(gm)).revision;
        await gm
            .getByRole('button', { name: 'Видимость Objects в редакторе', exact: true })
            .click();
        await gm
            .getByRole('button', { name: 'Блокировка Objects в редакторе', exact: true })
            .click();
        assert.equal((await snapshot(gm)).revision, revision);
        assert.equal(
            (await snapshot(player)).props.length,
            baseline.props.filter((p) => !p.isHidden).length + 1,
        );
        await gm.screenshot({ path: path.join(out, 'layers.png') });
        const reconnect = gm.waitForResponse(
            (r) => r.url().endsWith('/api/scenes/5/snapshot') && r.status() === 200,
        );
        await gm.evaluate(() => window.__mapQaDisconnect());
        await reconnect;
        await gm
            .getByRole('button', { name: 'Видимость Objects в редакторе' })
            .getAttribute('aria-pressed')
            .then((v) => assert.equal(v, 'false'));
        await gm.getByRole('button', { name: 'Видимость Objects в редакторе' }).click();
        await gm.getByRole('button', { name: 'Блокировка Objects в редакторе' }).click();
        report.checks.push(
            'Local layer visibility/edit lock do not mutate Scene revision or player visibility; reconnect retains local preferences',
        );
        await toolbar.getByRole('button', { name: 'Материалы', exact: true }).click();
        await gm.getByRole('button', { name: 'Создать материал', exact: true }).click();
        let form = gm.locator('.material-form');
        await form.getByLabel('Название', { exact: true }).fill('MAP-02 smoke stone');
        await form.getByRole('button', { name: 'Текстура из Global Assets', exact: true }).click();
        await chooseAsset(gm, copiedAsset.name);
        await number(form, 'Ширина повтора, world units', 140);
        await number(form, 'Базовый поворот, °', 30);
        assert.equal(await form.locator('.material-preview.large').count(), 1);
        await form.locator('.material-preview-status').waitFor({ state: 'detached' });
        await gm.screenshot({ path: path.join(out, 'material-preview.png') });
        const created = gm.waitForResponse(
            (r) => r.url().endsWith('/api/library/materials') && r.request().method() === 'POST',
        );
        await form.getByRole('button', { name: 'Сохранить материал', exact: true }).click();
        const result = await created;
        assert.equal(result.status(), 200);
        const material = await result.json();
        materialId = material.id;
        await form.waitFor({ state: 'detached' });
        await gm
            .getByRole('button', { name: 'Редактировать материал MAP-02 smoke stone', exact: true })
            .click();
        form = gm.locator('.material-form');
        await number(form, 'Ширина повтора, world units', 210);
        await form.getByRole('button', { name: 'Сохранить материал', exact: true }).click();
        await form.waitFor({ state: 'detached' });
        const list = await api(gm, '/library/materials?search=MAP-02%20smoke');
        assert.equal(list.data.materials[0].version, 2);
        assert.equal((await api(player, `/library/materials/${materialId}`, 'DELETE')).status, 403);
        assert.equal((await api(player, `/assets/${copiedAsset.id}/detail`)).status, 403);
        assert.equal((await api(gm, `/assets/${copiedAsset.id}`, 'DELETE')).status, 409);
        await gm.screenshot({ path: path.join(out, 'materials.png') });
        report.checks.push(
            'Create/edit versioned material with tiled scale/rotation preview; private asset access and used texture deletion protection',
        );
        // Existing MAP-01 settings are available without remounting the tabletop.
        await toolbar.getByRole('button', { name: 'Настройки карты и сетки', exact: true }).click();
        await gm.getByRole('complementary', { name: 'Подготовка карты', exact: true }).waitFor();
        assert.equal(await gm.locator('canvas').count(), 1);
        await gm.getByRole('button', { name: 'Закрыть подготовку карты', exact: true }).click();
        await gm.setViewportSize({ width: 980, height: 800 });
        await gm.screenshot({ path: path.join(out, 'compact.png') });
        await gm.reload();
        await gm.locator('.canvas-host canvas').waitFor();
        await editor(gm);
        assert.equal((await snapshot(gm)).props.find((p) => p.id === id).rotation, -35);
        await gm.goto(base + '/campaigns/5/scenes/5?mode=session');
        await gm.locator('.workspace.session-mode').waitFor();
        assert.equal(
            await gm.getByRole('toolbar', { name: 'Инструменты редактора карты' }).count(),
            0,
        );
        report.checks.push(
            'Settings/calibration preserved; compact workspace; props persist after reload; Session has no editor',
        );
        await until(async () => playerEvents.length > 0);
        assert.equal(JSON.stringify(playerEvents).includes('propEdits'), false);
        assert.deepEqual(report.errors, []);
    } finally {
        if (gm && baseline) {
            const current = await snapshot(gm),
                extra = current.props.filter((p) => !baseline.props.some((old) => old.id === p.id));
            if (extra.length)
                assert.equal(
                    (
                        await api(gm, '/scenes/5/selection', 'POST', {
                            action: 'delete',
                            tokenIds: [],
                            propIds: extra.map((p) => p.id),
                        })
                    ).status,
                    200,
                );
            if (materialId)
                assert.equal(
                    (await api(gm, `/library/materials/${materialId}`, 'DELETE')).status,
                    200,
                );
            if (copiedAsset)
                assert.equal((await api(gm, `/assets/${copiedAsset.id}`, 'DELETE')).status, 200);
            const restored = await snapshot(gm);
            assert.deepEqual(restored.props, baseline.props);
            assert.deepEqual(restored.tokens, baseline.tokens);
            report.restored = true;
        }
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
