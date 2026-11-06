/* eslint-disable @typescript-eslint/no-require-imports -- Local browser QA. */
/* global require, process, console, window */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const { api, login, mapState, tabletop, base } = require('./map07a.cjs');
const out = path.resolve('artifacts/map08a');
const scene = '/scenes/5';
const state = (page) => api(page, scene + '/snapshot');
const fixture = JSON.parse(fs.readFileSync('tests/Fixtures/los.json', 'utf8'));
const query = (page, a, b, range) =>
    api(page, scene + '/los', 'POST', { observer: { point: a }, targets: [{ point: b }], range });
const point = (x, y) => ({ x, y });
async function editor(page) {
    const close = page.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
    if (await close.isVisible()) await close.click();
    await page
        .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
        .click();
    await page.getByRole('button', { name: 'LOS debug', exact: true }).waitFor();
}
async function debugRequest(page, action) {
    const response = page.waitForResponse(
        (r) => r.url().endsWith('/api' + scene + '/los') && r.ok(),
    );
    await action();
    const result = await (await response).json();
    await page.getByRole('complementary', { name: 'Проверка LOS' }).waitFor();
    return result;
}
(async () => {
    fs.mkdirSync(out, { recursive: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let gm, baseline, setup, mapChanged, temporaryProp;
    let restored = false;
    const checks = [],
        errors = [],
        responses = [];
    try {
        gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
        );
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
        );
        for (const page of [gm, player]) page.on('pageerror', (e) => errors.push(e.message));
        gm.on('response', (response) => {
            if (response.url().endsWith('/api' + scene + '/los') && response.ok())
                response
                    .json()
                    .then((data) => responses.push(data))
                    .catch(() => {});
        });
        baseline = await state(gm);
        assert.equal(
            !!baseline.mapWorld,
            false,
            'Use legacy Scene 5 without replacing existing authored geometry',
        );
        const sourceScene = await api(gm, '/scenes/7/snapshot');
        assert.equal((await query(gm, point(100, 234), point(700, 234))).results[0].visible, true);
        await api(gm, scene + '/map-world', 'POST', {
            value: { ...mapState(baseline), enabled: true },
            expected: mapState(baseline),
        });
        mapChanged = true;
        setup = await api(gm, scene + '/structure', 'POST', {
            value: fixture.graph,
            expected: (await state(gm)).structure.hash,
        });
        for (const test of fixture.cases) {
            const result = await query(gm, test.a, test.b);
            assert.equal(result.results[0].visible, test.visible, test.name);
            checks.push(test.name);
        }
        const setDoor = async (open) =>
            api(gm, scene + '/structure', 'POST', {
                expected: (await state(gm)).structure.hash,
                door: { id: 'corridor-door', open },
            });
        const before = await query(gm, point(450, 700), point(650, 700));
        await setDoor(true);
        const after = await query(gm, point(450, 700), point(650, 700));
        assert.equal(after.results[0].visible, true);
        assert.notEqual(before.geometryKey, after.geometryKey);
        assert.equal(
            (await query(gm, point(450, 700), point(650, 700), 199)).results[0].reason,
            'out_of_range',
        );
        checks.push('Door state invalidates geometry; Euclidean range boundary');
        const preset = sourceScene.props.find((p) => p.preset && p.collider?.type !== 'none');
        assert.ok(preset, 'Existing permanent prop preset');
        const created = await api(gm, scene + '/props', 'POST', {
            action: 'create',
            presetId: preset.preset.presetId,
            x: 850,
            y: 950,
        });
        temporaryProp = created.props[0].id;
        const collider = {
            ...created.props[0].collider,
            blocksVision: true,
            blocksMovement: false,
            blocksLight: false,
        };
        await api(gm, scene + '/props', 'POST', {
            action: 'update',
            id: temporaryProp,
            patch: { collider, rotation: 35, scale_x: 1.4, scale_y: 0.6, is_hidden: true },
        });
        const blocked = await query(gm, point(700, 950), point(1000, 950));
        assert.equal(blocked.results[0].blocker.id, 'prop:' + temporaryProp);
        await api(gm, scene + '/props', 'POST', {
            action: 'update',
            id: temporaryProp,
            patch: {
                collider: {
                    ...collider,
                    blocksVision: false,
                    blocksMovement: true,
                    blocksLight: true,
                },
            },
        });
        const movementOnly = await query(gm, point(700, 950), point(1000, 950));
        assert.equal(movementOnly.results[0].visible, true);
        assert.notEqual(blocked.geometryKey, movementOnly.geometryKey);
        checks.push(
            'Hidden rotated/scaled furniture blocks vision independently of movement/light',
        );
        await gm.goto(base + '/campaigns/5/scenes/5');
        await tabletop(gm).waitFor();
        await editor(gm);
        const first = await debugRequest(gm, () =>
            gm.getByRole('button', { name: 'LOS debug', exact: true }).click(),
        );
        assert.equal(first.results.length, 32);
        const target = baseline.tokens.find((t) => t.id !== baseline.tokens[0].id);
        const tokenResult = await debugRequest(gm, () =>
            gm.getByLabel('LOS цель', { exact: true }).selectOption(target.id),
        );
        assert.equal(tokenResult.results.at(-1).rays.length, 9);
        await gm
            .getByRole('complementary', { name: 'Проверка LOS' })
            .locator('output')
            .filter({ hasText: /Цель:/ })
            .waitFor();
        await gm.screenshot({ path: path.join(out, 'gm-token-los.png') });
        const limited = await debugRequest(gm, () =>
            gm.getByLabel('Дальность LOS', { exact: true }).fill('1'),
        );
        assert.equal(limited.results.at(-1).visibility, 'none');
        await debugRequest(gm, () => gm.getByLabel('Дальность LOS', { exact: true }).fill('900'));
        const changed = gm.waitForResponse(
            (r) => r.url().endsWith('/api' + scene + '/los') && r.ok(),
        );
        await setDoor(false);
        const live = await (await changed).json();
        assert.equal(live.revision, (await state(gm)).revision);
        assert.notEqual(live.geometryKey, after.geometryKey);
        const editedGraph = (await state(gm)).structure.graph;
        editedGraph.vertices.find((v) => v.id === 'k').x += 20;
        const wallRefresh = gm.waitForResponse(
            (r) => r.url().endsWith('/api' + scene + '/los') && r.ok(),
        );
        await api(gm, scene + '/structure', 'POST', {
            value: editedGraph,
            expected: (await state(gm)).structure.hash,
        });
        const wallResult = await (await wallRefresh).json();
        assert.notEqual(wallResult.geometryKey, live.geometryKey);
        const propRefresh = gm.waitForResponse(
            (r) => r.url().endsWith('/api' + scene + '/los') && r.ok(),
        );
        await api(gm, scene + '/props', 'POST', {
            action: 'update',
            id: temporaryProp,
            patch: { collider, x: 880 },
        });
        const propResult = await (await propRefresh).json();
        assert.notEqual(propResult.geometryKey, wallResult.geometryKey);
        checks.push('GM debug invalidates after wall edit and hidden blocking prop transform');
        // Build remains usable while LOS stays mounted; switching back enables point probes.
        await gm.getByRole('button', { name: 'Build', exact: true }).click();
        await gm.getByRole('complementary', { name: 'Проверка LOS' }).waitFor();
        await gm.getByRole('button', { name: 'Выбор объектов', exact: true }).click();
        const coordinates = await gm.evaluate(() => {
            const world = window.tabletopApp.stage.children[0];
            const c = window.tabletopApp.canvas.getBoundingClientRect();
            return {
                x: c.x + world.x + 650 * world.scale.x,
                y: c.y + world.y + 700 * world.scale.y,
            };
        });
        const probe = await debugRequest(gm, () => gm.mouse.click(coordinates.x, coordinates.y));
        assert.ok(probe.results.at(-1).point);
        await gm.screenshot({ path: path.join(out, 'gm-point-los.png') });
        await gm.getByRole('button', { name: 'LOS debug', exact: true }).click();
        assert.equal(await gm.getByRole('complementary', { name: 'Проверка LOS' }).count(), 0);
        const count = responses.length;
        await gm.waitForTimeout(600);
        assert.equal(responses.length, count, 'No render-frame requests while debug disabled');
        checks.push(
            'GM token/point debug, footprint rays, range, realtime invalidation, Build coexistence, toggle off',
        );
        await gm.reload();
        assert.equal(await gm.getByRole('complementary', { name: 'Проверка LOS' }).count(), 0);
        const persisted = await query(gm, point(450, 700), point(650, 700));
        assert.equal(persisted.results[0].visible, false);
        checks.push('Reload uses persisted geometry and leaves transient debug off');
        await api(
            player,
            '/scenes/7/los',
            'POST',
            { observer: { point: point(1, 1) }, targets: [{ point: point(2, 2) }] },
            403,
        );
        await api(player, scene + '/los', 'POST', {}, 403);
        await player.goto(base + '/campaigns/5/play');
        await tabletop(player).waitFor();
        assert.equal(
            await player.getByRole('button', { name: 'LOS debug', exact: true }).count(),
            0,
        );
        const playerState = await api(player, '/scenes/7/snapshot');
        assert.ok(playerState.props.every((p) => !p.collider && !p.preset));
        assert.ok(!playerState.geometryKey && !playerState.losDebug);
        assert.ok(playerState.structure.graph.edges.every((e) => !('blocksVision' in e)));
        assert.equal(
            playerState.tokens.length,
            sourceScene.tokens.filter((t) => !t.isHidden).length,
        );
        checks.push(
            'Player denied LOS diagnostics before validation; projections contain no collider/LOS metadata; no automatic token filtering',
        );
        assert.deepEqual(errors, []);
    } catch (error) {
        if (gm) await gm.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
        throw error;
    } finally {
        try {
            if (gm && baseline) {
                if (temporaryProp)
                    await api(gm, scene + '/selection', 'POST', {
                        action: 'delete',
                        tokenIds: [],
                        propIds: [temporaryProp],
                    });
                if (setup)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'structure',
                                id: '5',
                                expected: { hash: (await state(gm)).structure.hash },
                                value: setup.structureEdit.before,
                            },
                        ],
                    });
                if (mapChanged)
                    await api(gm, scene + '/edit-history', 'POST', {
                        changes: [
                            {
                                kind: 'mapWorld',
                                id: '5',
                                expected: mapState(await state(gm)),
                                value: mapState(baseline),
                            },
                        ],
                    });
                const final = await state(gm);
                for (const key of ['props', 'tokens', 'mapWorld', 'structure', 'terrain', 'combat'])
                    assert.deepEqual(final[key], baseline[key], key);
                restored = true;
            }
        } finally {
            fs.writeFileSync(
                path.join(out, 'report.json'),
                JSON.stringify({ checks, errors, restored }, null, 2),
            );
            await browser.close();
        }
    }
    console.log(JSON.stringify({ checks, errors, restored }, null, 2));
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
