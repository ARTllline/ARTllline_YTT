/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console */
const fs = require('node:fs');
const path = require('node:path');
const percentile = (values, q) =>
    [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))];
const root = 'artifacts/map-engine-performance';
const rows = [];
for (const phase of process.argv.slice(2)) {
    const dir = path.join(root, phase),
        report = JSON.parse(fs.readFileSync(path.join(dir, 'motion-report.json')));
    for (const input of [...new Set(report.cases.map((c) => c.input))]) {
        const cases = report.cases.filter((c) => c.input === input),
            samples = [];
        for (const c of cases) {
            const raw = JSON.parse(
                fs.readFileSync(path.join(dir, `${input}-${c.repeat}-role1.json`)),
            );
            const m = raw.motion,
                events = raw.events ?? [],
                down = events.find((e) => e.type === 'keydown'),
                up = events.filter((e) => e.type === 'keyup').at(-1);
            const start = down?.t ?? m[0].t,
                end = up?.t ?? m.at(-1).t;
            let maxJump = 0,
                moved = 0,
                focus = 0,
                reveal = 0,
                last = start,
                maxGap = 0,
                separation = 0;
            if (down && m[0].t >= start && Math.hypot(m[0].x - m[0].cx, m[0].y - m[0].cy) > 0.01) {
                last = m[0].t;
                moved++;
                if (m[0].focus !== undefined) focus++;
            }
            for (let i = 1; i < m.length; i++) {
                const a = m[i - 1],
                    b = m[i],
                    d = Math.hypot(b.x - a.x, b.y - a.y);
                maxJump = Math.max(maxJump, d);
                separation = Math.max(separation, Math.hypot(b.x - b.cx, b.y - b.cy));
                if (b.t >= start && b.t <= end) {
                    if (d > 0.01) {
                        moved++;
                        maxGap = Math.max(maxGap, b.t - last);
                        last = b.t;
                    }
                    if (b.focus !== undefined && Math.abs(b.focus - a.focus) > 0.01) focus++;
                    if (b.reveal !== a.reveal) reveal++;
                }
            }
            maxGap = Math.max(maxGap, end - last);
            const duration = (end - start) / 1000;
            const final = m.at(-1),
                converged = m.findLastIndex((v) => Math.hypot(v.x - v.cx, v.y - v.cy) > 0.003);
            samples.push({
                distance: c.roles[1].distance,
                travelled: c.roles[1].travelled,
                latency: c.roles[1].visualLatency,
                p95: c.roles[1].frameMs.p95,
                maxJump,
                visualHz: moved / duration,
                focusHz: focus / duration,
                revealHz: reveal / duration,
                maxGap,
                separation,
                convergence: up ? Math.max(0, (m[converged + 1]?.t ?? final.t) - up.t) : null,
                finalError: Math.hypot(final.x - final.cx, final.y - final.cy),
                gmError: Math.abs(c.roles[0].distance - c.roles[1].distance),
                steps: c.motionRequests.filter(
                    (r) => r.url.endsWith('/step') || r.url.endsWith('/move'),
                ).length,
                requestMs: percentile(
                    c.motionRequests
                        .filter((r) => r.url.endsWith('/step') || r.url.endsWith('/move'))
                        .map((r) => r.elapsed),
                    0.5,
                ),
                masks: c.roles[1].masks,
                maskInterval: c.roles[1].maskIntervals.mean,
                longTasks: raw.longTasks.length,
            });
        }
        const median = (k) =>
            percentile(
                samples.map((s) => s[k]).filter((x) => x !== null && x !== undefined),
                0.5,
            );
        rows.push({
            phase,
            input,
            n: cases.length,
            restored: report.restored,
            build: report.build,
            median: Object.fromEntries(Object.keys(samples[0]).map((k) => [k, median(k)])),
            latencyP95: percentile(
                samples.map((s) => s.latency),
                0.95,
            ),
            maxJump: Math.max(...samples.map((s) => s.maxJump)),
            worstFrameP95: Math.max(...samples.map((s) => s.p95)),
            maxFinalError: Math.max(...samples.map((s) => s.finalError)),
            maxGmError: Math.max(...samples.map((s) => s.gmError)),
            longTasks: samples.reduce((n, s) => n + s.longTasks, 0),
        });
    }
}
console.log(JSON.stringify(rows, null, 2));
