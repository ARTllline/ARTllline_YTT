/* eslint-disable @typescript-eslint/no-require-imports -- Native integration QA on the permanent fixture. */
/* global require, process, console */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require(
    process.env.USERPROFILE +
        '/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { api, login, snapshot, scene } = require('./map07a.cjs');
const out = 'artifacts/map07e3';
fs.mkdirSync(out, { recursive: true });

async function run(file) {
    console.log('Running ' + file);
    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['scripts/qa/' + file + '.cjs'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const log = fs.createWriteStream(out + '/' + file + '.log');
        child.stdout.on('data', (data) => {
            log.write(data);
            process.stdout.write(data);
        });
        child.stderr.on('data', (data) => {
            log.write(data);
            process.stderr.write(data);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            log.end();
            if (code === 0) resolve();
            else reject(Error(file + ' exit ' + code));
        });
    });
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const accounts = JSON.parse(
        fs.readFileSync('artifacts/permanent-playground-20261030/accounts.private.json', 'utf8'),
    );
    const gm = await login(
        browser,
        accounts.find((a) => a.id === 1),
    );
    const active = (await api(gm, '/campaigns/5')).activeSceneId;
    const disabled = [];
    const report = { regressions: [], restored: false };
    const positions = (await snapshot(gm)).tokens.map(({ id, x, y, size, scale }) => ({
        id,
        x,
        y,
        size,
        scale,
    }));
    fs.writeFileSync(out + '/positions-before.json', JSON.stringify(positions, null, 2));
    try {
        for (const id of new Set([active, '5']))
            if (id) assert.equal((await api(gm, '/scenes/' + id + '/cues')).pendingCount, 0);
        for (const trigger of (await api(gm, scene + '/triggers')).triggers.filter(
            (t) => t.enabled,
        )) {
            await api(gm, scene + '/triggers', 'POST', {
                action: 'toggle',
                id: trigger.id,
                enabled: false,
            });
            disabled.push(trigger.id);
        }
        if (active !== '5') await api(gm, '/campaigns/5/activate', 'POST', { sceneId: '5' });
        for (const file of process.argv.slice(2).length
            ? process.argv.slice(2)
            : ['map07a', 'map07c', 'map07d', 'map07e1']) {
            await run(file);
            report.regressions.push(file);
        }
    } finally {
        for (const { id, ...position } of positions)
            await api(gm, '/tokens/' + id, 'PATCH', position);
        for (const id of disabled)
            await api(gm, scene + '/triggers', 'POST', { action: 'toggle', id, enabled: true });
        if (active && active !== '5')
            await api(gm, '/campaigns/5/activate', 'POST', { sceneId: active });
        assert.equal((await api(gm, '/campaigns/5')).activeSceneId, active);
        report.restored = true;
        fs.writeFileSync(out + '/integration-report.json', JSON.stringify(report, null, 2));
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
