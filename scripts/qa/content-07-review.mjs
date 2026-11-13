/* global process, document, console */
// Standalone report only. No live application, accounts or database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.env.USERPROFILE,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const bundle = JSON.parse(await readFile(path.join(root, 'resources/data/content/srd-2024-bulk-07/review.json'), 'utf8'));
const out = path.join(root, 'artifacts/content-07-review');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
    await page.goto(pathToFileURL(path.join(root, 'docs/CONTENT_07_APPROVAL.html')).href);
    await page.waitForSelector('#rows tr');
    assert.equal(await page.locator('#rows tr').count(), 797);
    for (const [status, count] of Object.entries(bundle.counts)) {
        await page.locator('#status').selectOption(status);
        assert.equal(await page.locator('#rows tr').count(), count);
    }
    await page.locator('#status').selectOption('');
    for (const [group, ids] of Object.entries(bundle.groups)) {
        await page.locator('#group').selectOption(group);
        assert.equal(await page.locator('#rows tr').count(), ids.length);
    }
    await page.locator('#group').selectOption('');
    await page.locator('#search').fill('srd:equipment:trident:2024');
    assert.equal(await page.locator('#rows tr').count(), 1);
    await page.locator('#rows button').click();
    assert.match(await page.locator('#detail').innerText(), /Trident/);
    await page.getByText('Исходные характеристики · raw / curated / provenance', { exact: true }).click();
    assert.match(await page.locator('#detail').innerText(), /1d6/);
    assert.match(await page.locator('#detail').innerText(), /1d8/);
    await page.locator('#search').fill('srd:magic_item:hat-of-many-spells:2024');
    await page.locator('#rows button').click();
    await page.getByText('Технические исправления нормализации', { exact: true }).click();
    assert.match(await page.locator('#detail').innerText(), /Very Rare/);
    assert.match(await page.locator('#checksum').textContent(), new RegExp(bundle.bundle_checksum));
    await page.screenshot({ path: path.join(out, 'approval-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true);
    await page.screenshot({ path: path.join(out, 'approval-mobile.png') });
    assert.deepEqual(errors, []);
    await writeFile(path.join(out, 'browser-report.json'), JSON.stringify({
        bundle_checksum: bundle.bundle_checksum, rows: 797, status_counts: bundle.counts,
        checks: ['all groups', 'source ID search', 'raw/curated damage', 'v5 rarity evidence', 'desktop/mobile no overflow', 'no JS errors'],
        live_database_access: false, database_writes: 0,
    }, null, 2));
    console.log('Standalone CONTENT-07 approval report: PASS (797 rows, all groups, inspector, desktop/mobile)');
} finally {
    await browser.close();
}
