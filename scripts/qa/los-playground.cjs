/* eslint-disable @typescript-eslint/no-require-imports -- Explicit local manual fixture extension. */
/* global require, process, console */
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
const fixture = JSON.parse(fs.readFileSync('tests/Fixtures/los.json', 'utf8'));
const route = '/scenes/7';
const offset = 2100;
const point = (p) => ({ x: p.x + offset, y: p.y });
const out = path.resolve('artifacts/map08a');

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        const gm = await login(
            browser,
            accounts.find((a) => a.id === 1),
        );
        const errors = [];
        gm.on('pageerror', (error) => errors.push(error.message));
        const before = await api(gm, route + '/snapshot');
        assert.equal(before.campaignId, '5');
        assert.ok(before.mapWorld && before.structure.graph.edges.some((e) => e.id === 'doors'));
        if (!process.argv.includes('--apply')) {
            console.log(
                'Read only. --apply adds a LOS wing at x=2100..3200 to existing Scene 7; existing movement zones and tokens are preserved.',
            );
            return;
        }
        fs.mkdirSync(out, { recursive: true });
        // Local ignored snapshot only; never contains account credentials.
        const backup = path.join(out, 'manual-scene7-before.private.json');
        if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(before));
        if (before.width < 3300) {
            await api(gm, route + '/map-world', 'POST', {
                value: { ...mapState(before), width: 3300 },
                expected: mapState(before),
            });
        }
        let current = await api(gm, route + '/snapshot');
        if (!current.structure.graph.edges.some((e) => e.id === 'los-partition')) {
            const wing = {
                vertices: fixture.graph.vertices.map((v) => ({ ...point(v), id: 'los-' + v.id })),
                edges: fixture.graph.edges.map((e) => ({
                    ...e,
                    id: 'los-' + e.id,
                    a: 'los-' + e.a,
                    b: 'los-' + e.b,
                })),
                rooms: [],
                openings: fixture.graph.openings.map((o) => ({
                    ...o,
                    id: 'los-' + o.id,
                    edgeId: 'los-' + o.edgeId,
                })),
            };
            const graph = {};
            for (const key of ['vertices', 'edges', 'rooms', 'openings'])
                graph[key] = [...(current.structure.graph[key] ?? []), ...wing[key]];
            await api(gm, route + '/structure', 'POST', {
                value: graph,
                expected: current.structure.hash,
            });
        }
        for (const [name, x, y] of [
            ['LOS · коридор', 2550, 700],
            ['LOS · за дверью', 2750, 700],
            ['LOS · окно', 2200, 400],
            ['LOS · за окном', 2120, 400],
            ['LOS · мебель', 2800, 950],
            ['LOS · за мебелью', 3100, 950],
        ]) {
            current = await api(gm, route + '/snapshot');
            if (!current.tokens.some((t) => t.name === name))
                await api(gm, route + '/tokens', 'POST', {
                    name,
                    x,
                    y,
                    kind: 'npc',
                    disposition: 'neutral',
                });
        }
        for (const [name, sourceName, x, y, hidden] of [
            ['LOS · шкаф', 'Полигон · crate', 2950, 950, false],
            ['LOS · скрытый эллипс', 'Полигон · round', 2950, 1100, true],
        ]) {
            current = await api(gm, route + '/snapshot');
            if (current.props.some((p) => p.name === name)) continue;
            const source = before.props.find((p) => p.name === sourceName);
            assert.ok(source?.preset?.presetId, sourceName);
            const created = await api(gm, route + '/props', 'POST', {
                action: 'create',
                presetId: source.preset.presetId,
                x,
                y,
            });
            await api(gm, route + '/props', 'POST', {
                action: 'update',
                id: created.props[0].id,
                patch: {
                    name,
                    rotation: 30,
                    scale_x: 1.3,
                    scale_y: 0.65,
                    is_hidden: hidden,
                    collider: {
                        ...source.collider,
                        blocksVision: true,
                        blocksMovement: false,
                        blocksLight: false,
                    },
                },
            });
        }
        current = await api(gm, route + '/snapshot');
        for (const key of ['tokens', 'props'])
            for (const original of before[key])
                assert.deepEqual(
                    current[key].find((v) => v.id === original.id),
                    original,
                );
        for (const key of ['vertices', 'edges', 'rooms', 'openings'])
            for (const original of before.structure.graph[key] ?? [])
                assert.deepEqual(
                    current.structure.graph[key].find((v) => v.id === original.id),
                    original,
                );
        for (const key of ['map', 'terrain', 'combat', 'grid'])
            assert.deepEqual(current[key], before[key], key);
        const checks = [];
        for (const test of fixture.cases) {
            const result = await api(gm, route + '/los', 'POST', {
                observer: { point: point(test.a) },
                targets: [{ point: point(test.b) }],
            });
            assert.equal(result.results[0].visible, test.visible, test.name);
            checks.push(test.name);
        }
        for (const [observer, target, expected] of [
            ['LOS · коридор', 'LOS · за дверью', 'none'],
            ['LOS · окно', 'LOS · за окном', 'full'],
            ['LOS · мебель', 'LOS · за мебелью', 'none'],
        ]) {
            const result = await api(gm, route + '/los', 'POST', {
                observer: { tokenId: current.tokens.find((t) => t.name === observer).id },
                targets: [{ tokenId: current.tokens.find((t) => t.name === target).id }],
            });
            assert.equal(result.results[0].visibility, expected, observer);
            checks.push(observer + ': ' + expected);
        }
        await gm.goto(base + '/campaigns/5/scenes/7');
        await tabletop(gm).waitFor();
        const close = gm.getByRole('button', { name: 'Закрыть библиотеку', exact: true });
        if (await close.isVisible()) await close.click();
        await gm
            .getByRole('button', { name: /^(Редактировать карту|Создать редактируемую карту)$/ })
            .click();
        await gm.getByRole('button', { name: 'LOS debug', exact: true }).click();
        await gm
            .getByLabel('LOS наблюдатель', { exact: true })
            .selectOption(current.tokens.find((t) => t.name === 'LOS · коридор').id);
        await gm
            .getByLabel('LOS цель', { exact: true })
            .selectOption(current.tokens.find((t) => t.name === 'LOS · за дверью').id);
        await gm
            .getByRole('complementary', { name: 'Проверка LOS' })
            .locator('output')
            .filter({ hasText: 'Цель: не видна' })
            .waitFor();
        await gm.locator('.scene-title-arrival').waitFor({ state: 'detached' });
        await gm.screenshot({ path: path.join(out, 'manual-scene7-los.png') });
        const player = await login(
            browser,
            accounts.find((a) => a.id === 2),
        );
        const publicScene = await api(player, route + '/snapshot');
        assert.ok(!publicScene.props.some((p) => p.name === 'LOS · скрытый эллипс'));
        assert.ok(publicScene.props.every((p) => !p.collider));
        assert.deepEqual(errors, []);
        fs.writeFileSync(
            path.join(out, 'manual-report.json'),
            JSON.stringify(
                { scene: 7, checks, preservedMovementFixture: true, secretPropFiltered: true },
                null,
                2,
            ),
        );
        console.log(
            JSON.stringify({
                scene: 7,
                checks,
                preservedMovementFixture: true,
                secretPropFiltered: true,
            }),
        );
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
