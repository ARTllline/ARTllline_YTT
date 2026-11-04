/* global console */
import { build } from 'esbuild';
import { Buffer } from 'node:buffer';
import { writeFileSync, mkdirSync } from 'node:fs';

// Bundle the actual browser algorithm; no independent benchmark implementation.
const bundled = await build({
    entryPoints: ['resources/js/tabletop/navigation/pathfinding.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
});
const { findRoute } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);
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
const scenarios = [
    {
        name: '801 obstacles / around a building',
        start: { x: 40, y: 2200 },
        target: { x: 3750, y: 2200 },
        extra: [box(1750, 2100, 160, 120)],
    },
    {
        name: '800 furniture obstacles / diagonal',
        start: { x: 40, y: 40 },
        target: { x: 3750, y: 2150 },
    },
    {
        name: '800 furniture obstacles / across rows',
        start: { x: 40, y: 310 },
        target: { x: 3750, y: 310 },
    },
    {
        name: '800 furniture obstacles / no route',
        start: { x: 40, y: 40 },
        target: { x: 3750, y: 2150 },
        extra: [box(1900, 0, 20, 2300)],
    },
];
const report = [];
for (const scenario of scenarios) {
    const runs = [];
    for (let i = 0; i < 12; i++) {
        const result = findRoute({
            ...scenario,
            radius: 10,
            gridSize: 60,
            width: 3900,
            height: 2300,
            obstacles: [...obstacles, ...(scenario.extra ?? [])],
        });
        runs.push(result);
    }
    const timings = runs.map((r) => r.elapsed).sort((a, b) => a - b);
    report.push({
        scenario: scenario.name,
        obstacles: obstacles.length + (scenario.extra?.length ?? 0),
        status: runs.at(-1).status,
        expanded: runs.at(-1).expanded,
        points: runs.at(-1).path.length,
        medianMs: +timings[6].toFixed(2),
        p95Ms: +timings[11].toFixed(2),
    });
}
mkdirSync('artifacts/map07c', { recursive: true });
writeFileSync('artifacts/map07c/benchmark.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
