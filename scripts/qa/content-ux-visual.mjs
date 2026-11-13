/* global structuredClone, document */
import assert from 'node:assert/strict';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { visualSamples } from '../../tests/Fixtures/content/visual-samples.mjs';

export async function checkVisualCatalog({ page, state, open, fixture, out }) {
    const sample = visualSamples(fixture);
    assert.equal(sample.recordCount, 30);
    await page.setViewportSize({ width: 1720, height: 1280 });
    await open('items');
    await page
        .getByRole('button', { name: 'Предмет: Кольцо звёздного пути · мой', exact: true })
        .waitFor();
    await page
        .getByRole('button', { name: 'Предмет: Longsword · системный', exact: true })
        .waitFor();
    assert.equal(await page.locator('.catalog-entry').count(), 15);
    await page.screenshot({ path: path.join(out, 'polish-items-catalog.png') });
    const inspect = page.getByRole('complementary', { name: 'Просмотр предмета' });
    for (const d of [...state.items, ...fixture.items.entries.map((r) => r.definition)]) {
        const custom = state.items.some((row) => row.id === d.id);
        await page
            .getByRole('button', {
                name: `Предмет: ${d.name} · ${custom ? 'мой' : 'системный'}`,
                exact: true,
            })
            .click();
        await inspect.getByRole('heading', { name: d.name, exact: true }).waitFor();
        assert.equal(await inspect.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await page
        .getByRole('button', {
            name: 'Предмет: Клинок хранителя северного перевала · мой',
            exact: true,
        })
        .click();
    await inspect.evaluate((el) => (el.scrollTop = 0));
    assert.match(await inspect.innerText(), /Редкий/);
    assert.match(await inspect.innerText(), /рубящий/);
    await page.screenshot({ path: path.join(out, 'polish-item-inspector.png') });
    const model = state.items[0];
    state.items = Array.from({ length: 150 }, (_, i) => ({
        ...structuredClone(model),
        id: randomUUID(),
        name: `Тестовая коллекция ${String(i + 1).padStart(3, '0')}`,
    }));
    await open('items');
    await page.getByRole('button', { name: 'Мои', exact: true }).click();
    await page
        .getByRole('button', { name: 'Предмет: Тестовая коллекция 001 · мой', exact: true })
        .waitFor();
    assert.equal(await page.locator('.catalog-entry').count(), 24);
    await page
        .getByRole('navigation', { name: 'Страницы предметов' })
        .getByRole('button', { name: 'Далее', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Предмет: Тестовая коллекция 025 · мой', exact: true })
        .waitFor();
    assert.equal(await page.locator('.catalog-entry').count(), 24);
    await page.getByLabel('Найти предмет', { exact: true }).fill('150');
    await page
        .getByRole('button', { name: 'Предмет: Тестовая коллекция 150 · мой', exact: true })
        .waitFor();
    state.items = sample.items;
    await open('spells');
    await page.getByRole('button', { name: 'Заклинание: Искра рассвета', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Заклинание: Fireball', exact: true }).waitFor();
    assert.equal(await page.locator('.catalog-entry').count(), 15);
    await page.screenshot({ path: path.join(out, 'polish-spells-catalog.png') });
    const spellInspect = page.getByRole('complementary', { name: 'Просмотр заклинания' });
    for (const s of [...state.spells, ...fixture.spells.entries]) {
        await page
            .getByRole('button', { name: `Заклинание: ${s.ability.name}`, exact: true })
            .click();
        await spellInspect.getByRole('heading', { name: s.ability.name, exact: true }).waitFor();
        assert.equal(
            await spellInspect.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
            true,
        );
    }
    await page.getByRole('button', { name: 'Заклинание: Fireball', exact: true }).click();
    await spellInspect.evaluate((el) => (el.scrollTop = 0));
    assert.match(await spellInspect.innerText(), /Воплощение/);
    assert.match(await spellInspect.innerText(), /Мгновенно/);
    await page.screenshot({ path: path.join(out, 'polish-spell-inspector.png') });
    await page.getByRole('button', { name: 'Заклинание: Wish', exact: true }).click();
    await spellInspect.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const titleBox = await spellInspect.locator('.catalog-card-header').boundingBox(),
        panelBox = await spellInspect.boundingBox();
    assert.ok(titleBox.y >= panelBox.y - 2);
    for (const kind of ['items', 'spells']) {
        await page.setViewportSize({ width: 390, height: 844 });
        await open(kind);
        const name =
            kind === 'items'
                ? 'Предмет: Безымянный трофей из затерянной обсерватории на краю мира с очень длинным названием · мой'
                : 'Заклинание: Долгое превращение хранителя древней обсерватории на краю мира';
        await page.getByRole('button', { name, exact: true }).click();
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('catalog-inspector'),
        );
        assert.equal(
            await page.evaluate(() =>
                [
                    ...document.querySelectorAll(
                        '.control-main,.catalog-inspector,.compendium-catalog',
                    ),
                ].every((el) => el.scrollWidth <= el.clientWidth + 1),
            ),
            true,
        );
        await page.screenshot({ path: path.join(out, `polish-${kind}-mobile.png`) });
        await page.getByRole('button', { name: 'К каталогу', exact: true }).click();
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('catalog-entry'),
        );
    }
}
