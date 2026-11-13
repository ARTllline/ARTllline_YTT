/* global URL, process, structuredClone, setTimeout, console, document */
// Interactive frontend regression tests against real API projections exported by
// CompendiumConsumersTest on SQLite :memory:. All browser API calls are intercepted.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { visualSamples } from '../../tests/Fixtures/content/visual-samples.mjs';
import { checkVisualCatalog } from './content-ux-visual.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'artifacts/content-ux');
await mkdir(out, { recursive: true });
const php = spawnSync(
    'php',
    [
        'vendor/phpunit/phpunit/phpunit',
        '--filter',
        'test_visual_catalog_filters_and_independent_library_copies',
    ],
    {
        cwd: root,
        env: { ...process.env, YTT_CONTENT_UX_FIXTURE: '1' },
        encoding: 'utf8',
        timeout: 180_000,
    },
);
process.stdout.write(php.stdout ?? '');
process.stderr.write(php.stderr ?? '');
assert.equal(php.status, 0, 'SQLite fixture contract tests must pass before browser QA');
const fixture = JSON.parse(await readFile(path.join(out, 'api-fixture.json'), 'utf8'));
const require = createRequire(import.meta.url);
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
// No Laravel Vite plugin: this server never creates public/hot.
const server = await createServer({
    configFile: false,
    root,
    plugins: [react()],
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const results = [];
try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    async function scenario(name, run, visual = false) {
        const context = await browser.newContext({
            viewport: { width: 1512, height: 1080 },
            reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const personal = structuredClone(fixture.itemCopy);
        Object.assign(personal, { id: randomUUID(), name: 'Клинок Флинна', icon: 'asset:999999' });
        const custom = structuredClone(fixture.spellCopy);
        custom.id += 10000;
        custom.ability.name = 'Пламя Флинна';
        const sample = visual ? visualSamples(fixture) : null;
        const state = {
            items: sample ? sample.items : [personal],
            spells: sample ? sample.spells : [custom],
            posts: [],
            failList: false,
            failCopy: false,
            delay: 0,
        };
        await page.route('**/api/**', async (route) => {
            const req = route.request(),
                url = new URL(req.url()),
                endpoint = url.pathname,
                query = url.searchParams;
            if (!endpoint.startsWith('/api/')) return route.continue();
            const respond = (body, status = 200) => route.fulfill({ status, json: body });
            if (endpoint.startsWith('/api/assets/')) return respond({}, 404);
            if (endpoint === '/api/campaigns') return respond({ campaigns: [] });
            if (endpoint === '/api/library/characters') return respond({ characters: [] });
            if (endpoint === '/api/library/character-rules/catalog')
                return respond(fixture.characterCatalog);
            if (req.method() === 'POST') {
                const body = req.postDataJSON();
                state.posts.push({ endpoint, body });
                assert.match(body.clientMutationId, /^[\da-f-]{36}$/i);
                if (state.failCopy) return respond({ message: 'Fixture unavailable' }, 503);
                if (endpoint === '/api/library/items/compendium') {
                    assert.equal(
                        body.entryId,
                        fixture.items.entries.find((r) => r.definition.name === 'Longsword').id,
                    );
                    const definition = structuredClone(fixture.itemCopy);
                    state.items.push(definition);
                    return respond({ definition });
                }
                if (endpoint === '/api/library/items') {
                    const definition = { ...body };
                    state.items = state.items.map((d) => (d.id === body.id ? definition : d));
                    return respond({ definition });
                }
                if (endpoint === '/api/library/spells') {
                    if (body.copyFrom) {
                        assert.equal(
                            body.copyFrom,
                            fixture.spells.entries.find((r) => r.ability.name === 'Fireball').id,
                        );
                        assert.equal(body.ability.name, 'Fireball');
                        const entry = structuredClone(fixture.spellCopy);
                        state.spells.push(entry);
                        return respond({ entry });
                    }
                    const entry = {
                        ...state.spells.find((s) => s.id === body.id),
                        ability: body.ability,
                    };
                    state.spells = state.spells.map((s) => (s.id === body.id ? entry : s));
                    return respond({ entry });
                }
                throw new Error(`Unexpected mutation: ${endpoint}`);
            }
            if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
            if (state.failList && endpoint.endsWith('/compendium')) return respond({}, 503);
            if (endpoint === '/api/library/items') return respond({ definitions: state.items });
            let rows;
            if (endpoint === '/api/library/items/compendium') {
                rows = fixture.items.entries.filter(
                    (r) =>
                        (!query.get('type') || fixture.itemTypes[r.id] === query.get('type')) &&
                        r.definition.name
                            .toLowerCase()
                            .includes((query.get('search') ?? '').trim().toLowerCase()),
                );
            } else if (endpoint === '/api/library/spells') {
                rows = [...fixture.spells.entries, ...state.spells].filter(
                    (r) =>
                        (!query.get('origin') ||
                            (query.get('origin') === 'custom' ? r.custom : !r.custom)) &&
                        (!query.has('level') ||
                            r.ability.spell.level === Number(query.get('level'))) &&
                        (!query.get('school') ||
                            r.ability.spell.school.toLowerCase() === query.get('school')) &&
                        r.ability.name
                            .toLowerCase()
                            .includes((query.get('search') ?? '').trim().toLowerCase()),
                );
            } else throw new Error(`Unexpected API read: ${endpoint}`);
            const currentPage = Number(query.get('page') ?? 1);
            return respond({
                entries: rows.slice((currentPage - 1) * 24, currentPage * 24),
                total: rows.length,
                pages: Math.max(1, Math.ceil(rows.length / 24)),
                page: currentPage,
            });
        });
        const open = (kind) =>
            page.goto(`${base}/tests/Fixtures/content/catalog.html?kind=${kind}`);
        try {
            await run({ page, state, open, fixture, out });
            assert.deepEqual(errors, [], 'No frontend runtime errors');
            results.push({ name, passed: true });
            console.log(`PASS ${name}`);
        } catch (e) {
            console.error('Browser runtime errors:', errors);
            console.error('Visible UI:', (await page.locator('body').innerText()).slice(0, 1500));
            await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
            throw e;
        } finally {
            await context.close();
        }
    }

    await scenario(
        'Items: search → inspect → independent copy → edit → reload',
        async ({ page, state, open }) => {
            await open('items');
            await page
                .getByRole('button', { name: 'Предмет: Клинок Флинна · мой', exact: true })
                .waitFor();
            await page.getByRole('button', { name: 'Системные', exact: true }).click();
            await page.getByLabel('Категория предметов').selectOption('weapons');
            await page.getByLabel('Найти предмет', { exact: true }).fill('Longsword');
            await page
                .getByRole('button', { name: 'Предмет: Longsword · системный', exact: true })
                .click();
            const card = page.getByRole('complementary', { name: 'Просмотр предмета' });
            await card.getByRole('heading', { name: 'Longsword', exact: true }).waitFor();
            assert.match(await card.innerText(), /1d8/);
            assert.match(await card.innerText(), /dnd-2024/);
            await card
                .getByRole('button', { name: 'Копировать в мою коллекцию', exact: true })
                .click();
            await page.getByText('Независимая копия добавлена', { exact: false }).waitFor();
            assert.equal(state.posts.length, 1);
            await card.getByRole('button', { name: 'Редактировать', exact: true }).click();
            await card.getByLabel('Название предмета', { exact: true }).fill('Мой длинный меч');
            const saved = page.waitForResponse(
                (r) => r.url().endsWith('/api/library/items') && r.request().method() === 'POST',
            );
            await card.getByRole('button', { name: 'Сохранить предмет', exact: true }).click();
            assert.equal((await saved).status(), 200);
            await card.getByRole('button', { name: 'Редактировать', exact: true }).waitFor();
            await card.getByRole('heading', { name: 'Мой длинный меч', exact: true }).waitFor();
            await open('items');
            await page.getByRole('button', { name: 'Мои', exact: true }).click();
            await page
                .getByRole('button', { name: 'Предмет: Мой длинный меч · мой', exact: true })
                .waitFor();
            assert.equal(
                fixture.items.entries.find((r) => r.definition.name === 'Longsword').definition
                    .name,
                'Longsword',
            );
        },
    );

    await scenario(
        'Spells: filters → inspect → independent copy → edit → reload',
        async ({ page, state, open }) => {
            await open('spells');
            await page.getByRole('button', { name: 'Системные', exact: true }).click();
            await page.getByLabel('Круг заклинаний').selectOption('3');
            await page.getByLabel('Школа магии').selectOption('evocation');
            await page.getByLabel('Найти заклинание').fill('Fireball');
            await page.getByRole('button', { name: 'Заклинание: Fireball', exact: true }).click();
            const card = page.getByRole('complementary', { name: 'Просмотр заклинания' });
            assert.match(await card.innerText(), /Частично/);
            assert.match(await card.innerText(), /8d6/);
            await card
                .getByRole('button', { name: 'Копировать в мою коллекцию', exact: true })
                .click();
            await page.getByText('Независимая копия добавлена', { exact: false }).waitFor();
            assert.equal(state.posts.length, 1);
            await card.getByRole('button', { name: 'Редактировать', exact: true }).click();
            await page.getByLabel('Название заклинания', { exact: true }).fill('Мой огненный шар');
            const saved = page.waitForResponse(
                (r) => r.url().endsWith('/api/library/spells') && r.request().method() === 'POST',
            );
            await card.getByRole('button', { name: 'Сохранить заклинание', exact: true }).click();
            assert.equal((await saved).status(), 200);
            await card.getByRole('button', { name: 'Редактировать', exact: true }).waitFor();
            await card.getByRole('heading', { name: 'Мой огненный шар', exact: true }).waitFor();
            await open('spells');
            await page.getByRole('button', { name: 'Мои', exact: true }).click();
            await page
                .getByRole('button', { name: 'Заклинание: Мой огненный шар', exact: true })
                .waitFor();
            assert.equal(
                fixture.spells.entries.find((s) => s.ability.name === 'Fireball').ability.name,
                'Fireball',
            );
        },
    );

    await scenario(
        'Loading, empty results, reset, missing artwork, network retry and denied copy',
        async ({ page, state, open }) => {
            state.delay = 600;
            await open('items');
            await page
                .getByRole('status')
                .filter({ hasText: 'Открываем компендиум' })
                .first()
                .waitFor();
            await page
                .getByRole('button', { name: 'Предмет: Клинок Флинна · мой', exact: true })
                .waitFor();
            await page.getByLabel('Иконка отсутствует').first().waitFor();
            await page.getByLabel('Найти предмет', { exact: true }).fill('ZZZ-no-results');
            await page.getByRole('heading', { name: 'Ничего не найдено' }).waitFor();
            await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
            await page
                .getByRole('button', { name: 'Предмет: Longsword · системный', exact: true })
                .waitFor();
            state.failList = true;
            await page.getByLabel('Найти предмет', { exact: true }).fill('Long');
            await page.getByRole('alert').waitFor();
            state.failList = false;
            await page.getByRole('button', { name: 'Повторить', exact: true }).click();
            await page
                .getByRole('button', { name: 'Предмет: Longsword · системный', exact: true })
                .click();
            state.failCopy = true;
            await page
                .getByRole('button', { name: 'Копировать в мою коллекцию', exact: true })
                .click();
            await page.getByRole('alert').waitFor();
            state.failCopy = false;
            await page
                .getByRole('button', { name: 'Копировать в мою коллекцию', exact: true })
                .click();
            await page.getByText('Независимая копия добавлена', { exact: false }).waitFor();
            assert.equal(
                state.posts[0].body.clientMutationId,
                state.posts[1].body.clientMutationId,
                'Ambiguous retries retain mutation identity',
            );
            await open('spells');
            await page.getByLabel('Найти заклинание').fill('Wish');
            await page.getByRole('button', { name: 'Заклинание: Wish', exact: true }).click();
            assert.equal(
                await page
                    .getByRole('button', { name: 'Копировать в мою коллекцию', exact: true })
                    .isDisabled(),
                true,
            );
            assert.match(
                await page.getByRole('complementary', { name: 'Просмотр заклинания' }).innerText(),
                /Решение ГМ/,
            );
            await page.screenshot({ path: path.join(out, 'manual-spell.png') });
        },
    );

    await scenario(
        'Desktop, tablet and mobile: keyboard preview, focus, long reference and no overflow',
        async ({ page, open }) => {
            for (const kind of ['items', 'spells']) {
                await page.setViewportSize({ width: 1512, height: 1080 });
                await open(kind);
                const label =
                    kind === 'items' ? 'Предмет: Longsword · системный' : 'Заклинание: Fireball';
                const row = page.getByRole('button', { name: label, exact: true });
                await row.focus();
                await page.keyboard.press('Enter');
                const card = page.getByRole('complementary', {
                    name: kind === 'items' ? 'Просмотр предмета' : 'Просмотр заклинания',
                });
                await card
                    .getByRole('heading', {
                        name: kind === 'items' ? 'Longsword' : 'Fireball',
                        exact: true,
                    })
                    .waitFor();
                await page.screenshot({ path: path.join(out, `${kind}-desktop.png`) });
                for (const width of [900, 390]) {
                    await page.setViewportSize({ width, height: 844 });
                    await row.click();
                    await page.waitForFunction(() =>
                        document.activeElement?.classList.contains('catalog-inspector'),
                    );
                    assert.equal(
                        await page.evaluate(() =>
                            [
                                ...document.querySelectorAll(
                                    '.control-main, .compendium-catalog, .catalog-inspector',
                                ),
                            ].every((el) => el.scrollWidth <= el.clientWidth + 1),
                        ),
                        true,
                        `${kind} must fit at ${width}px`,
                    );
                    await page.screenshot({
                        path: path.join(out, `${kind}-${width === 390 ? 'mobile' : 'tablet'}.png`),
                    });
                    await card.getByRole('button', { name: 'К каталогу', exact: true }).click();
                    await page.waitForFunction(() =>
                        document.activeElement?.closest('.compendium-catalog'),
                    );
                }
            }
        },
    );
    await scenario(
        'Visual polish: 30 varied records and 150-entry private collection',
        checkVisualCatalog,
        true,
    );
    await writeFile(
        path.join(out, 'browser-report.json'),
        JSON.stringify(
            {
                fixture:
                    'SQLite :memory: API projections, browser requests intercepted; no live DB',
                results,
            },
            null,
            2,
        ),
    );
    console.log(`${results.length} browser scenarios passed; screenshots: ${out}`);
} finally {
    await browser?.close();
    await server.close();
}
