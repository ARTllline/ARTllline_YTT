/* eslint-disable @typescript-eslint/no-require-imports -- Run the built production Worker in Chrome. */
/* global require, process, console, Worker, performance, setInterval, clearInterval */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(
    path.join(
        process.env.USERPROFILE,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
    ),
);
const { login, tabletop, base } = require('./map07a.cjs');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const accounts = JSON.parse(
            fs.readFileSync(
                'artifacts/permanent-playground-20261030/accounts.private.json',
                'utf8',
            ),
        );
        const page = await login(
            browser,
            accounts.find((a) => a.id === 2),
        );
        await page.goto(base + '/campaigns/5/play');
        await tabletop(page).waitFor();
        await page.bringToFront();
        const file = fs
            .readdirSync('public/build/assets')
            .find((name) => /^pathfinding\.worker-.*\.js$/.test(name));
        assert.ok(file);
        const result = await page.evaluate(
            async (url) => {
                const box = (x, y, w, h) => ({
                    points: [
                        { x, y },
                        { x: x + w, y },
                        { x: x + w, y: y + h },
                        { x, y: y + h },
                    ],
                    padding: 0,
                });
                const obstacles = Array.from({ length: 800 }, (_, i) =>
                    box(120 + (i % 40) * 90, 80 + Math.floor(i / 40) * 100, 48, 55),
                );
                return new Promise((resolve, reject) => {
                    const worker = new Worker(url, { type: 'module' });
                    let beats = 0,
                        maxGap = 0,
                        previous = performance.now();
                    const timer = setInterval(() => {
                        const now = performance.now();
                        beats++;
                        maxGap = Math.max(maxGap, now - previous);
                        previous = now;
                    }, 10);
                    const timeout = setInterval(() => {
                        clearInterval(timeout);
                        clearInterval(timer);
                        worker.terminate();
                        reject(Error('Worker timed out'));
                    }, 3000);
                    worker.onerror = () => {
                        clearInterval(timer);
                        clearInterval(timeout);
                        worker.terminate();
                        reject(Error('Worker failed'));
                    };
                    worker.onmessage = ({ data }) => {
                        clearInterval(timer);
                        clearInterval(timeout);
                        worker.terminate();
                        resolve({
                            obstacles: 800,
                            status: data.status,
                            expanded: data.expanded,
                            workerMs: +data.elapsed.toFixed(2),
                            mainThreadHeartbeats: beats,
                            maxHeartbeatGapMs: +maxGap.toFixed(2),
                        });
                    };
                    worker.postMessage({
                        start: { x: 40, y: 40 },
                        target: { x: 3750, y: 2150 },
                        radius: 10,
                        width: 3900,
                        height: 2300,
                        gridSize: 60,
                        obstacles,
                    });
                });
            },
            base + '/build/assets/' + file,
        );
        assert.ok(['waypoints', 'budget', 'found'].includes(result.status));
        assert.ok(
            result.mainThreadHeartbeats >= 2,
            'Main thread must stay responsive while the Worker searches',
        );
        fs.writeFileSync(
            'artifacts/map07c/browser-benchmark.json',
            JSON.stringify(result, null, 2),
        );
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
