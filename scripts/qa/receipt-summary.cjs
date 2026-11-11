/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console */
const fs = require('node:fs');
const percentile = (values, q) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
};
const stats = (a) => ({
    n: a.length,
    p50: percentile(a, 0.5),
    p95: percentile(a, 0.95),
    max: Math.max(...a),
});
const logs = new Map(
    fs
        .readFileSync('storage/logs/performance.jsonl', 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
            const row = JSON.parse(line);
            return [row.id, row];
        }),
);
const result = process.argv.slice(2).map((phase) => {
    const report = JSON.parse(
        fs.readFileSync(`artifacts/map-engine-performance/${phase}/motion-report.json`),
    );
    const requests = report.cases
        .flatMap((c) => c.requests)
        .filter((r) => /\/(move|step)$/.test(r.path));
    const rows = requests.map((r) => logs.get(r.id)).filter(Boolean);
    return {
        phase,
        restored: report.restored,
        errors: report.errors,
        build: report.build,
        insertMs: stats(
            rows.flatMap((r) =>
                r.queries
                    .filter((q) => q.sql.startsWith('insert ignore into `scene_mutation_receipts`'))
                    .map((q) => q.ms),
            ),
        ),
        appMs: stats(rows.map((r) => r.metrics.app)),
        sqlMs: stats(rows.map((r) => r.metrics.sql)),
        commitCallbacksMs: stats(rows.map((r) => r.metrics.commit_callbacks)),
        dragResponseMs: stats(
            report.cases
                .filter((c) => c.input === 'drag')
                .flatMap((c) => c.motionRequests.map((r) => r.elapsed)),
        ),
        dragPlaybackLatencyMs: stats(
            report.cases.filter((c) => c.input === 'drag').map((c) => c.roles[1].visualLatency),
        ),
        wasdDistance: stats(
            report.cases.filter((c) => c.input === 'wasd').map((c) => c.roles[1].distance),
        ),
        worstFrameP95: Math.max(...report.cases.flatMap((c) => c.roles.map((r) => r.frameMs.p95))),
        failedMotion: report.cases.flatMap((c) => c.motionRequests.filter((r) => r.status !== 200)),
    };
});
console.log(JSON.stringify(result, null, 2));
