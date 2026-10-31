/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS QA entrypoint. */
/* global require, __dirname, __filename, process, setTimeout, window, document, requestAnimationFrame, URL, fetch, crypto, console, CustomEvent, performance */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const arg = process.argv.slice(2);
const rounds = Number(arg.find((v) => v.startsWith('--rounds='))?.split('=')[1] ?? 10);
assert(Number.isInteger(rounds) && rounds >= 8 && rounds <= 150);
const heapDiagnostics = arg.includes('--heap-diagnostics');
assert(rounds <= 12 || arg.includes('--full'), 'More than 12 rounds requires explicit --full');
const base = 'http://localhost:8090';
assert(
    /^APP_ENV=["']?local["']?\s*$/m.test(fs.readFileSync(path.join(root, '.env'), 'utf8')),
    'Local environment only',
);
const bundled = path.join(
    process.env.USERPROFILE,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
const { chromium } = createRequire(__filename)(process.env.YTT_PLAYWRIGHT_MODULE || bundled);
const out = path.join(root, 'artifacts/tech02', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(out, { recursive: true });
const report = {
    roundsRequested: rounds,
    completedRounds: 0,
    checkpoints: [],
    findings: [],
    restored: false,
    workload: 'townhouse-v1',
};
report.versions = {
    node: process.version,
    harnessSHA256: createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    manifestSHA256: createHash('sha256')
        .update(fs.readFileSync(path.join(root, 'public/build/manifest.json')))
        .digest('hex'),
};
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
const reset = () =>
    execFileSync(process.env.YTT_PHP || 'php', ['artisan', 'qa:townhouse'], {
        cwd: root,
        stdio: 'pipe',
    });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Read-only bridge into the existing React owners. Never stores scene/renderer references.
function install() {
    window.__soak = { frames: [], marks: [] };
    window.__yttPerformance = (phase, value) => {
        if (phase === 'pixi') {
            window.__soak.marks.push(value.revision);
            if (window.__soak.marks.length > 256) window.__soak.marks.shift();
        }
    };
    let last;
    const tick = (now) => {
        if (last) {
            window.__soak.frames.push(now - last);
            if (window.__soak.frames.length > 4096) window.__soak.frames.shift();
        }
        last = now;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__soakOwner = () => {
        const node = document.querySelector('.player-gameplay, .canvas-host');
        let f = node?.[Object.keys(node).find((k) => k.startsWith('__reactFiber'))];
        while (f) {
            if (f.memoizedProps?.store && (f.memoizedProps.renderer || f.memoizedProps.rendererRef))
                return f.memoizedProps;
            f = f.return;
        }
        throw new Error('React owner unavailable; update QA bridge for this build');
    };
    window.__soakTransport = (connect) => {
        const node = document.querySelector('.player-view');
        let f = node[Object.keys(node).find((k) => k.startsWith('__reactFiber'))];
        while (f) {
            let h = f.memoizedState;
            while (h && typeof h === 'object') {
                const p = h.memoizedState?.connector?.pusher;
                if (p) {
                    p[connect ? 'connect' : 'disconnect']();
                    return;
                }
                h = h.next;
            }
            f = f.return;
        }
        throw new Error('Transport unavailable');
    };
}
const projection = (s) => ({
    revision: s.revision,
    combat: s.combat,
    tokens: s.tokens
        .map((t) => ({ id: t.id, x: t.x, y: t.y, hp: t.hp, conditions: t.conditions }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    characters: s.characters?.map((c) => ({ id: c.id, hp: c.hp })),
    activeCharacterId: s.activeCharacterId,
});
(async () => {
    let browser;
    const clients = [];
    try {
        reset();
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        report.versions.chrome = browser.version();
        for (const account of JSON.parse(
            fs.readFileSync(
                path.join(root, 'artifacts/permanent-playground-20261030/accounts.private.json'),
                'utf8',
            ),
        )) {
            const context = await browser.newContext({
                viewport: { width: 1440, height: 1000 },
                reducedMotion: 'no-preference',
            });
            await context.addInitScript(install);
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            const c = {
                id: account.id,
                page,
                context,
                latency: [],
                events: new Map(),
                recent: new Set(),
                duplicates: 0,
                duplicateSubscriptions: 0,
                subscribeAttempts: 0,
                sockets: [],
                errors: [],
            };
            clients.push(c);
            page.on('pageerror', () => c.errors.push('pageerror'));
            page.on('requestfinished', (r) => {
                if (r.url().includes('/api/')) {
                    const t = r.timing();
                    c.latency.push({ path: new URL(r.url()).pathname, ms: t.responseEnd });
                    if (c.latency.length > 4096) c.latency.shift();
                }
            });
            page.on('websocket', (ws) => {
                const channels = new Set();
                c.sockets.push(channels);
                ws.on('close', () => channels.clear());
                ws.on('framesent', (f) => {
                    try {
                        const v = JSON.parse(String(f.payload));
                        if (v.event === 'pusher:subscribe') {
                            c.subscribeAttempts++;
                            if (channels.has(v.data.channel)) c.duplicateSubscriptions++;
                            channels.add(v.data.channel);
                        }
                        if (v.event === 'pusher:unsubscribe') channels.delete(v.data.channel);
                    } catch {
                        /* Ignore non-JSON protocol frames. */
                    }
                });
                ws.on('framereceived', (f) => {
                    try {
                        let v = JSON.parse(String(f.payload));
                        if (v.event !== 'tabletop') return;
                        const channel = v.channel;
                        v = typeof v.data === 'string' ? JSON.parse(v.data) : v.data;
                        if (!v.mutationId) return;
                        const key = channel + ':' + v.mutationId + ':' + v.revision;
                        if (c.recent.has(key)) c.duplicates++;
                        c.recent.add(key);
                        if (c.recent.size > 512) c.recent.delete(c.recent.values().next().value);
                        c.events.set(key, { id: v.mutationId, revision: v.revision });
                    } catch {
                        /* Ignore non-JSON protocol frames. */
                    }
                });
            });
            await page.goto(base + '/login');
            await page.locator('input[type=email]').fill(account.email);
            await page.locator('input[name=password]').fill(account.password);
            await page.locator('form button.primary-button').click();
            await page.waitForURL((u) => !u.pathname.includes('login'));
            await page.goto(base + (c.id === 1 ? '/campaigns/5/scenes/5' : '/campaigns/5/play'));
            await page.locator('.canvas-host canvas').waitFor();
            await page.getByText('На связи', { exact: true }).waitFor();
            c.cdp = await context.newCDPSession(page);
        }
        const gm = clients.find((c) => c.id === 1),
            players = clients.filter((c) => c.id !== 1);
        assert.equal(players.length, 2);
        const call = async (c, url, body, method = 'POST') => {
            report.lastCommand = { user: c.id, url, method };
            const r = await c.page.evaluate(
                async ({ url, body, method }) => {
                    const r = await fetch('/api' + url, {
                        method,
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content,
                        },
                        ...(method === 'GET'
                            ? {}
                            : {
                                  body: JSON.stringify({
                                      ...body,
                                      clientMutationId: crypto.randomUUID(),
                                  }),
                              }),
                    });
                    return { status: r.status, data: await r.json() };
                },
                { url, body, method },
            );
            assert.equal(r.status, 200, `${method} ${url}: ${r.status} ${r.data.message || ''}`);
            return r.data;
        };
        const snapshot = (c) => call(c, '/scenes/5/snapshot', null, 'GET');
        const sync = async () => {
            for (const c of players) {
                const expected = await snapshot(c);
                await c.page.waitForFunction(
                    (rev) => window.__soakOwner().store.getSnapshot().scene.revision === rev,
                    expected.revision,
                );
                const live = await c.page.evaluate(
                    () => window.__soakOwner().store.getSnapshot().scene,
                );
                assert.deepEqual(
                    projection(live),
                    projection(expected),
                    'Player projection desync',
                );
                assert.equal(await c.page.locator('.character-hud').count(), 1);
                assert.equal(c.duplicates, 0);
                assert.equal(c.duplicateSubscriptions, 0);
                assert.equal(c.errors.length, 0);
            }
        };
        async function checkpoint(label) {
            await sync();
            await sleep(500);
            const rows = [];
            for (const c of clients) {
                assert.equal(c.duplicates, 0, 'Duplicate scene mutation');
                assert.equal(c.duplicateSubscriptions, 0, 'Repeated active channel subscription');
                assert.equal(c.errors.length, 0, 'Uncaught browser error');
                const rawHeap = await c.cdp.send('Runtime.getHeapUsage');
                await c.cdp.send('HeapProfiler.collectGarbage');
                const heap = await c.cdp.send('Runtime.getHeapUsage');
                const dom = await c.cdp.send('Memory.getDOMCounters');
                const ui = await c.page.evaluate(() => {
                    const p = window.__soakOwner(),
                        r = (p.renderer || p.rendererRef).current;
                    let objects = 0;
                    const walk = (n) => {
                        objects++;
                        n.children?.forEach(walk);
                    };
                    if (r?.app?.stage) walk(r.app.stage);
                    const frames = window.__soak.frames.splice(0);
                    return {
                        frames,
                        displayObjects: objects,
                        tabletopCanvas: document.querySelectorAll('.canvas-host canvas').length,
                        dice: document.querySelector('.player-dice-park')?.dataset.initializations,
                        diagnosticFrames: window.__soak.frames.length,
                        diagnosticMarks: window.__soak.marks.length,
                        resourceTimings: performance.getEntriesByType('resource').length,
                        localMutations: p.store.localMutations.size,
                    };
                });
                const sorted = ui.frames.sort((a, b) => a - b);
                const latency = c.latency.splice(0).filter((t) => t.ms >= 0);
                rows.push({
                    user: c.id,
                    rawHeapBytes: rawHeap.usedSize,
                    heapBytes: heap.usedSize,
                    ...dom,
                    displayObjects: ui.displayObjects,
                    tabletopCanvas: ui.tabletopCanvas,
                    diceInitializations: ui.dice,
                    frameSamples: sorted.length,
                    frameP95: sorted[Math.floor(sorted.length * 0.95)],
                    frameOver50ms: sorted.filter((v) => v > 50).length,
                    api: latency,
                    activeChannels: c.sockets.flatMap((s) => [...s]),
                    mutationEvents: c.events.size,
                    duplicateEvents: c.duplicates,
                    subscribeAttempts: c.subscribeAttempts,
                    duplicateSubscriptions: c.duplicateSubscriptions,
                    diagnosticMarks: ui.diagnosticMarks,
                    resourceTimings: ui.resourceTimings,
                    localMutations: ui.localMutations,
                });
                if (heapDiagnostics) {
                    // Drain measurement temporaries / allow pending UI fetches to finish.
                    // Diagnostic GC is never part of the gameplay loop.
                    await sleep(1000);
                    await c.cdp.send('HeapProfiler.collectGarbage');
                    rows.at(-1).settledHeapBytes = (
                        await c.cdp.send('Runtime.getHeapUsage')
                    ).usedSize;
                }
                assert.equal(ui.tabletopCanvas, 1);
            }
            report.checkpoints.push({ label, round: report.completedRounds, rows });
            save();
            console.log('checkpoint', label, report.completedRounds);
            // Only acquire private snapshots after a sustained late linear trend.
            // The first captured checkpoint then becomes the snapshot baseline.
            if (heapDiagnostics && label === 'round-50') {
                const at = (round, id) =>
                    report.checkpoints
                        .find((p) => p.label === `round-${round}`)
                        ?.rows.find((r) => r.user === id);
                report.snapshotDiagnostics = players.some((c) => {
                    const a = at(25, c.id),
                        b = at(50, c.id);
                    return a && b && b.settledHeapBytes - a.settledHeapBytes > 500000;
                });
            }
            if (
                report.snapshotDiagnostics &&
                ['round-50', 'round-75', 'round-100'].includes(label)
            ) {
                for (const c of players) {
                    const filename = `${label}-player-${c.id}.heapsnapshot`;
                    const fd = fs.openSync(path.join(out, filename), 'w');
                    const write = (event) => fs.writeSync(fd, event.chunk);
                    c.cdp.on('HeapProfiler.addHeapSnapshotChunk', write);
                    try {
                        await c.cdp.send('HeapProfiler.takeHeapSnapshot', {
                            reportProgress: false,
                        });
                    } finally {
                        c.cdp.off('HeapProfiler.addHeapSnapshotChunk', write);
                        fs.closeSync(fd);
                    }
                    report.privateSnapshots ??= [];
                    report.privateSnapshots.push(filename);
                }
                save();
            }
        }
        let s = await snapshot(gm);
        const target = s.tokens.find((t) => t.disposition === 'hostile' && !t.isHidden);
        assert(target);
        // Warm portals before baseline, so React's one-time body delegation is not misread as a leak.
        for (const c of players) {
            await c.page.keyboard.press('KeyI');
            await c.page.locator('.window-inventory').waitFor();
            await c.page.getByRole('button', { name: 'Закрыть RPG окно', exact: true }).click();
            await c.page.locator('.rpg-window').waitFor({ state: 'detached' });
        }
        for (const [i, c] of players.entries()) {
            const own = await snapshot(c);
            c.character = own.activeCharacterId;
            c.actor = own.tokens.find((t) => t.characterId === c.character).id;
            c.origin = { x: target.x - s.grid.size, y: target.y + i * s.grid.size };
            await call(gm, '/tokens/' + c.actor + '/move', c.origin);
        }
        await call(gm, '/scenes/5/combat/begin', { combatId: s.combat.id });
        await checkpoint('baseline');
        for (let round = 1; round <= rounds; round++) {
            s = await snapshot(gm);
            const combatId = s.combat.id;
            const turns = s.combat.combatants.length;
            for (let turn = 0; turn < turns; turn++) {
                s = await snapshot(gm);
                const entry = s.combat.combatants.find(
                    (e) => e.id === s.combat.currentTurn.combatantId,
                );
                const c = players.find((p) => p.actor === entry.tokenId);
                if (c) {
                    await call(gm, '/scenes/5/adventuring', {
                        action: 'revive',
                        tokenId: target.id,
                        hp: target.maxHp,
                    });
                    await call(c, '/tokens/' + c.actor + '/move', {
                        x: c.origin.x + (round % 2 ? s.grid.size : 0),
                        y: c.origin.y,
                    });
                    await sync();
                    await c.page.waitForFunction(
                        () => document.querySelector('.hud-portrait')?.disabled === false,
                    );
                    const inv = await call(
                        c,
                        '/campaigns/5/characters/' + c.character + '/inventory',
                        null,
                        'GET',
                    );
                    const item = inv.items.find(
                        (i) => i.action?.available && i.action.ability?.attack,
                    );
                    const own = await snapshot(c);
                    const spell = own.characters
                        .find((v) => v.id === c.character)
                        .abilities.find(
                            (v) =>
                                v.enabled &&
                                v.spell?.level === 0 &&
                                v.target === 'token' &&
                                v.attack,
                        );
                    assert(item || spell, 'No prepared attack/cantrip for player');
                    await c.page.evaluate(
                        ({ item, ability }) =>
                            window.dispatchEvent(
                                new CustomEvent(item ? 'ytt:inventory-use' : 'ytt:ability-invoke', {
                                    detail: item || { abilityId: ability },
                                }),
                            ),
                        { item: item?.id, ability: spell?.id },
                    );
                    await c.page.locator('.ability-cursor').waitFor();
                    const order = await c.page.evaluate(() =>
                        window
                            .__soakOwner()
                            .store.getSnapshot()
                            .scene.tokens.map((t) => t.id),
                    );
                    for (let i = 0; i <= order.indexOf(target.id); i++)
                        await c.page.keyboard.press('Tab');
                    await c.page.keyboard.press('Enter');
                    await c.page.locator('dialog.ability-dialog[open]').waitFor();
                    await c.page.getByRole('button', { name: 'Продолжить', exact: true }).waitFor();
                    await c.page.locator('.physical-dice-stage.state-settled').waitFor();
                    await c.page.getByRole('button', { name: 'Продолжить', exact: true }).click();
                    await c.page.locator('dialog.ability-dialog').waitFor({ state: 'detached' });
                    if (round % 5 === 0) {
                        await c.page.keyboard.press('KeyI');
                        await c.page.locator('.window-inventory').waitFor();
                        await c.page
                            .getByRole('button', { name: 'Закрыть RPG окно', exact: true })
                            .click();
                        await c.page.locator('.rpg-window').waitFor({ state: 'detached' });
                    }
                }
                const result = await call(gm, '/scenes/5/combat/next', {
                    combatId,
                    expectedRound: s.combat.round,
                    expectedCurrentCombatantId: entry.id,
                });
                for (const p of players)
                    await p.page.waitForFunction(
                        (rev) => window.__soak.marks.includes(rev),
                        result.revision,
                    );
                // Every accepted turn must have one corresponding WS mutation per connected client.
                for (const p of clients)
                    assert(
                        [...p.events.values()].some((e) => e.id === result.mutationId),
                        'Missing turn event',
                    );
            }
            const condition = await call(gm, '/tokens/' + players[0].actor + '/condition-add', {
                key: 'poisoned',
                visibility: 'public',
            });
            const token =
                condition.token ||
                (await snapshot(gm)).tokens.find((t) => t.id === players[0].actor);
            const mark = token.conditions.find((v) => v.key === 'poisoned');
            assert(mark);
            await call(gm, '/tokens/' + players[0].actor + '/condition-remove', {
                conditionId: mark.id,
            });
            report.completedRounds = round;
            await sync();
            save();
            console.log('round', round);
            if ([10, 25, 50, 75, 100, 125, 150, rounds].includes(round))
                await checkpoint('round-' + round);
            if (round === Math.floor(rounds / 2)) {
                const p = players[0];
                await p.context.setOffline(true);
                await p.page.evaluate(() => window.__soakTransport(false));
                await p.page.getByText('На связи', { exact: true }).waitFor({ state: 'hidden' });
                await call(gm, '/tokens/' + p.actor + '/hp-set', { value: 30 });
                await snapshot(players[1]);
                await p.context.setOffline(false);
                await p.page.evaluate(() => window.__soakTransport(true));
                await p.page.getByText('На связи', { exact: true }).waitFor();
                await checkpoint('after-reconnect');
            }
            // Bounded diagnostic buffers: keep counts and last round only, not 50 rounds of payloads.
            for (const c of clients) c.events.clear();
        }
        await call(gm, '/scenes/5/combat/end', { combatId: (await snapshot(gm)).combat.id });
        await sleep(3000);
        await checkpoint('final-idle-cleanup');
        report.success = true;
    } catch (e) {
        report.success = false;
        report.failure = String(e.message).slice(0, 800);
        console.error(report.failure);
        process.exitCode = 1;
    } finally {
        try {
            if (browser) await browser.close();
        } catch {
            report.findings.push('Browser close failed; inspect orphan QA Chrome processes');
            process.exitCode = 1;
        }
        try {
            reset();
            report.restored = true;
        } catch {
            report.findings.push(
                'RESTORE FAILED: run php artisan qa:townhouse before any further QA',
            );
            process.exitCode = 1;
        }
        save();
        console.log('Report:', out);
    }
})();
