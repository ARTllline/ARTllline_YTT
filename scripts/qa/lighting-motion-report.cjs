/* eslint-disable @typescript-eslint/no-require-imports -- Summarize actual Chromium traces; no live mutations. */
/* global require, process, console */
const fs = require('node:fs');
const path = require('node:path');
const finalPhase = process.argv[2] ?? 'map10a-final';
const map10b = finalPhase.startsWith('map10b');
const phases = [
    'final-verified',
    'map10a-control-clean',
    ...new Set([...(map10b ? ['map10a-final'] : []), finalPhase, ...process.argv.slice(3)]),
];
const root = 'artifacts/vision-motion';
const stats = (a) => {
    a = a.filter(Number.isFinite).sort((x, y) => x - y);
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
const evidence = {
    method: 'Native Chromium 156, GM + 2 Players in isolated contexts, 1680x1050; zoom 29/50/100%; 2.6s WASD + settling, 800-unit Click-to-Move. No GPU readback/captures during measurements. Light pass time is CPU submission, not a GPU timer. Historical MAP-09.1 and a fresh no-light control are shown separately.',
    phases: [],
};
for (const phase of phases) {
    const report = JSON.parse(fs.readFileSync(path.join(root, phase, 'report.json'), 'utf8'));
    const groups = [];
    for (const input of ['wasd', 'click']) {
        const cases = report.cases.filter((c) => c.mode === 'fog' && c.input === input);
        const requests = cases.flatMap((c) => c.requests);
        const metric = (key) =>
            stats(
                requests.map((r) =>
                    Number(
                        r.server?.match(new RegExp('(?:^|, )' + key + ';dur=([0-9.]+)'))?.[1] ?? 0,
                    ),
                ),
            );
        const roles = [0, 1, 2].map((role) => {
            const samples = cases.map((c) =>
                JSON.parse(
                    fs.readFileSync(
                        path.join(
                            root,
                            phase,
                            `fog-${input}-${Math.round(c.zoom * 100)}-role${role}-frames.json`,
                        ),
                        'utf8',
                    ),
                ),
            );
            const deltas = samples.flatMap((s) =>
                s.frames.slice(1).map((f, i) => f.t - s.frames[i].t),
            );
            const frameMs = stats(deltas);
            const lightErrors = samples.flatMap((s) =>
                s.frames
                    .filter((f) => Number.isFinite(f.lx))
                    .map((f) => Math.hypot(f.lx - f.x, f.ly - f.y)),
            );
            const paths = {};
            for (const s of samples)
                for (const m of s.marks.filter((m) => m.phase === 'http.start'))
                    paths[m.path] = (paths[m.path] ?? 0) + 1;
            return {
                role,
                fps: (1000 * deltas.length) / frameMs.sum,
                frameMs,
                backsteps: samples.reduce(
                    (n, s) =>
                        n + s.frames.slice(1).filter((f, i) => f.x < s.frames[i].x - 0.5).length,
                    0,
                ),
                maxTokenStep: Math.max(...cases.map((c) => c.roles[role].maxTokenStep)),
                meanDistance: cases.reduce((n, c) => n + c.roles[role].distance, 0) / cases.length,
                movementResets: cases.reduce((n, c) => n + c.roles[role].movementResets, 0),
                lightCenterError: stats(lightErrors),
                memoryAllocations: cases.reduce((n, c) => n + c.roles[role].allocations, 0),
                lightingAllocations: cases.reduce(
                    (n, c) => n + (c.roles[role].lightingAllocations ?? 0),
                    0,
                ),
                lightingPassCpuMs: stats(samples.flatMap((s) => s.lightPasses ?? [])),
                lightingPasses: cases.reduce((n, c) => n + (c.roles[role].lightingPasses ?? 0), 0),
                lightingUploads: cases.reduce(
                    (n, c) => n + (c.roles[role].lightingUploads ?? 0),
                    0,
                ),
                httpPaths: paths,
            };
        });
        groups.push({
            input,
            completed: cases.map((c) => c.completed ?? null),
            zooms: cases.map((c) => c.zoom),
            commands: requests.length,
            httpMs: stats(requests.map((r) => r.timing.responseEnd - r.timing.requestStart)),
            appMs: metric('app'),
            projectionMs: metric('lighting_projection'),
            lightPolygonMs: metric('lighting_polygon'),
            losMs: metric('los_polygon'),
            fogMs: metric('fog_record'),
            roles,
        });
    }
    evidence.phases.push({
        phase,
        environment: report.environment,
        errors: report.errors,
        restored: report.restored,
        groups,
    });
}
const f = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');
let md = `# ${map10b ? 'MAP-10B' : 'MAP-10A'} · Movement + Vision + Fog + Lighting\n\n` + evidence.method + '\n\n';
for (const p of evidence.phases) {
    md += `## ${p.phase}\n\nJS errors: ${p.errors.length}; restored: ${p.restored}.\n\n| Input | Role | FPS | Frame p95/p99 ms | HTTP p50/p95 ms | Distance in window | Max step | Backsteps/resets | Light pass p95 ms | Light allocations |\n|---|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
    for (const g of p.groups)
        for (const r of g.roles)
            md += `| ${g.input} | ${['GM', 'Player 1', 'Player 2'][r.role]} | ${f(r.fps)} | ${f(r.frameMs.p95)} / ${f(r.frameMs.p99)} | ${f(g.httpMs.p50)} / ${f(g.httpMs.p95)} | ${f(r.meanDistance)} | ${f(r.maxTokenStep)} | ${r.backsteps}/${r.movementResets} | ${f(r.lightingPassCpuMs.p95)} | ${r.lightingAllocations} |\n`;
    md += '\n';
}
const out = map10b ? 'artifacts/map10b' : 'artifacts/map10a';
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(out + '/performance.json', JSON.stringify(evidence, null, 2));
fs.writeFileSync(out + '/performance.md', md);
console.log(
    JSON.stringify(
        evidence.phases.map((p) => ({
            phase: p.phase,
            errors: p.errors.length,
            restored: p.restored,
            groups: p.groups.map((g) => ({
                input: g.input,
                http: g.httpMs,
                lightProjection: g.projectionMs,
                player: g.roles[1],
            })),
        })),
        null,
        2,
    ),
);
