/* eslint-disable @typescript-eslint/no-require-imports -- Summarize sanitized local performance evidence. */
/* global require, process, console */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('artifacts/vision-motion');
const after = process.argv[2] ?? 'final-verified';
const stats = (values) => {
    const a = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!a.length) return { n: 0 };
    const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
    return {
        n: a.length,
        p50: q(0.5),
        p95: q(0.95),
        p99: q(0.99),
        max: a.at(-1),
        sum: a.reduce((s, x) => s + x, 0),
    };
};
const phases = ['before-clean', after];
const reports = phases.map((phase) => ({
    phase,
    report: JSON.parse(fs.readFileSync(path.join(root, phase, 'report.json'), 'utf8')),
}));
const ids = new Set(
    reports.flatMap(({ report }) => report.cases.flatMap((c) => c.requests.map((r) => r.id))),
);
const server = new Map();
for (const line of fs.readFileSync('storage/logs/performance.jsonl', 'utf8').trim().split('\n')) {
    const row = JSON.parse(line);
    if (ids.has(row.id))
        server.set(row.id, {
            metrics: row.metrics,
            counts: row.counts,
            queryCount: row.queryCount,
            bytes: row.bytes,
        });
}
const comparison = {
    method: 'Chromium, GM + two isolated Players, 1680x1050; zoom 29/50/100%; 2.6s held WASD and an 800-unit Click-to-Move. Original broken baseline is mostly idle after one step. CPU submission is not GPU timer-query time. Server spans are inclusive; fog_record includes its LOS build.',
    phases: [],
};
for (const { phase, report } of reports) {
    const groups = [];
    fs.writeFileSync(
        path.join(root, phase, 'server.json'),
        JSON.stringify(
            Object.fromEntries(
                [...server].filter(([id]) =>
                    report.cases.some((c) => c.requests.some((r) => r.id === id)),
                ),
            ),
            null,
            2,
        ),
    );
    for (const mode of ['none', 'vision', 'fog'])
        for (const input of ['wasd', 'click']) {
            const cases = report.cases.filter((c) => c.mode === mode && c.input === input);
            const requests = cases.flatMap((c) => c.requests);
            const traces = requests.map((r) => server.get(r.id)).filter(Boolean);
            const roles = [0, 1, 2].map((role) => {
                const frames = cases.map(
                    (c) =>
                        JSON.parse(
                            fs.readFileSync(
                                path.join(
                                    root,
                                    phase,
                                    `${mode}-${input}-${Math.round(c.zoom * 100)}-role${role}-frames.json`,
                                ),
                                'utf8',
                            ),
                        ).frames,
                );
                const dt = frames.flatMap((a) => a.slice(1).map((f, i) => f.t - a[i].t));
                const timing = stats(dt);
                return {
                    role,
                    fps: dt.length ? dt.length / (timing.sum / 1000) : null,
                    frameMs: timing,
                    backsteps: frames.reduce(
                        (n, a) => n + a.slice(1).filter((f, i) => f.x < a[i].x - 0.5).length,
                        0,
                    ),
                    maxTokenStep: Math.max(...cases.map((c) => c.roles[role].maxTokenStep)),
                    meanDistance:
                        cases.reduce((n, c) => n + c.roles[role].distance, 0) / cases.length,
                    maskPasses: cases.reduce((n, c) => n + c.roles[role].maskPasses, 0),
                    memoryAllocations: cases.reduce((n, c) => n + c.roles[role].allocations, 0),
                    maskPassCpuMs: stats(
                        cases.flatMap((c) =>
                            JSON.parse(
                                fs.readFileSync(
                                    path.join(
                                        root,
                                        phase,
                                        `${mode}-${input}-${Math.round(c.zoom * 100)}-role${role}-frames.json`,
                                    ),
                                    'utf8',
                                ),
                            ).passes.map((p) => p.ms),
                        ),
                    ),
                };
            });
            const metric = (name) =>
                stats(traces.map((t) => t.metrics[name]).filter((v) => v !== undefined));
            groups.push({
                mode,
                input,
                commands: requests.length,
                completed: cases.map((c) => c.completed ?? false),
                httpMs: stats(
                    requests
                        .map((r) => r.timing.responseEnd - r.timing.requestStart)
                        .filter((v) => v > 0),
                ),
                serverMs: metric('app'),
                projectionMs: metric('vision_projection'),
                checksMs: metric('character_checks'),
                losMs: metric('los_polygon'),
                fogMs: metric('fog_record'),
                losBuilds: traces.reduce((n, t) => n + (t.counts?.los_polygon ?? 0), 0),
                roles,
            });
        }
    comparison.phases.push({ phase, restored: report.restored, errors: report.errors, groups });
}
fs.writeFileSync(path.join(root, 'comparison.json'), JSON.stringify(comparison, null, 2));
let md = '# MAP-09.1 measurement evidence\n\n' + comparison.method + '\n\n';
const f = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
for (const phase of comparison.phases) {
    md += `## ${phase.phase}\n\nJS errors: ${phase.errors.length}; restored: ${phase.restored}.\n\n`;
    md +=
        '| Mode | Input | Role | FPS | frame p95/p99 ms | HTTP p50/p95 ms | Commands/LOS builds | Mask passes | Memory allocations | Distance | Max step | Backsteps |\n|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
    for (const g of phase.groups)
        for (const r of g.roles)
            md += `| ${g.mode} | ${g.input} | ${['GM', 'Player 1', 'Player 2'][r.role]} | ${f(r.fps)} | ${f(r.frameMs.p95)} / ${f(r.frameMs.p99)} | ${f(g.httpMs.p50)} / ${f(g.httpMs.p95)} | ${g.commands} / ${g.losBuilds} | ${r.maskPasses} | ${r.memoryAllocations} | ${f(r.meanDistance)} | ${f(r.maxTokenStep)} | ${r.backsteps} |\n`;
    md += '\n';
}
fs.writeFileSync(path.join(root, 'comparison.md'), md);
console.log(
    JSON.stringify(
        comparison.phases.map((p) => ({
            phase: p.phase,
            errors: p.errors.length,
            groups: p.groups.map((g) => ({
                mode: g.mode,
                input: g.input,
                http: g.httpMs,
                player: g.roles[1],
            })),
        })),
        null,
        2,
    ),
);
