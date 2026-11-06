<?php

// Pure geometry benchmark. No application/database boot or persistent mutations.
require __DIR__.'/../../vendor/autoload.php';

use App\Services\LineOfSight;
use App\Services\ShapeIntersection;
use App\Services\StructuralGeometry;

$graph = ['vertices' => [], 'edges' => [], 'rooms' => []];
for ($i = 0; $i < 500; $i++) {
    $x = ($i % 25) * 300 + 150;
    $y = intdiv($i, 25) * 300 + 50;
    $graph['vertices'][] = ['id' => "a$i", 'x' => $x, 'y' => $y];
    $graph['vertices'][] = ['id' => "b$i", 'x' => $x + 30, 'y' => $y + 150];
    $graph['edges'][] = ['id' => "w$i", 'a' => "a$i", 'b' => "b$i", 'thickness' => 16,
        'blocksMovement' => false, 'blocksVision' => true, 'blocksLight' => false, 'materialVersionId' => null];
}
$start = hrtime(true);
$compiled = StructuralGeometry::compile($graph);
$los = new LineOfSight($compiled);
$compileMs = (hrtime(true) - $start) / 1e6;
$rays = [];
mt_srand(808);
for ($i = 0; $i < 3000; $i++) {
    $a = ['x' => mt_rand(0, 7500), 'y' => mt_rand(0, 6000)];
    $rays[] = [$a, ['x' => $a['x'] + mt_rand(-600, 600), 'y' => $a['y'] + mt_rand(-600, 600)]];
}
$run = static function ($query) use ($rays) {
    $times = [];
    $visible = [];
    foreach ($rays as [$a, $b]) {
        $start = hrtime(true);
        $visible[] = $query($a, $b);
        $times[] = (hrtime(true) - $start) / 1e6;
    }
    sort($times);

    return ['totalMs' => round(array_sum($times), 2), 'p50Ms' => round($times[1500], 4),
        'p95Ms' => round($times[2850], 4), 'maxMs' => round(max($times), 4), 'visible' => $visible];
};
$indexed = $run(fn ($a, $b) => $los->point($a, $b)['visible']);
$kernel = new ShapeIntersection;
$linear = $run(fn ($a, $b) => ! $kernel->intersects($a, $b, LineOfSight::EPSILON, $compiled['shapes']));
if ($indexed['visible'] !== $linear['visible']) {
    throw new RuntimeException('Spatial filtering changed LOS results');
}
$diagnostic = $run(fn ($a, $b) => $los->point($a, $b, null, true)['visible']);
if ($indexed['visible'] !== $diagnostic['visible']) {
    throw new RuntimeException('Diagnostics changed LOS results');
}
unset($indexed['visible'], $linear['visible'], $diagnostic['visible']);
echo json_encode(['obstacles' => 500, 'rays' => count($rays), 'compileAndIndexMs' => round($compileMs, 2),
    'indexed' => $indexed, 'linear' => $linear, 'diagnostic' => $diagnostic,
    'peakMemoryMiB' => round(memory_get_peak_usage(true) / 1048576, 2)], JSON_PRETTY_PRINT).PHP_EOL;
