<?php

// Pure geometry; no DB boot or persistent mutations.
require __DIR__.'/../../vendor/autoload.php';

use App\Services\LineOfSight;
use App\Services\StructuralGeometry;
use App\Services\VisibilityPolygon;

$graph = ['vertices' => [], 'edges' => [], 'rooms' => []];
for ($i = 0; $i < 500; $i++) {
    $x = ($i % 25) * 300 + 150;
    $y = intdiv($i, 25) * 300 + 50;
    $graph['vertices'][] = ['id' => "a$i", 'x' => $x, 'y' => $y];
    $graph['vertices'][] = ['id' => "b$i", 'x' => $x + 30, 'y' => $y + 150];
    $graph['edges'][] = ['id' => "w$i", 'a' => "a$i", 'b' => "b$i", 'thickness' => 16,
        'blocksMovement' => false, 'blocksVision' => true, 'blocksLight' => false, 'materialVersionId' => null];
}
$compiled = StructuralGeometry::compile($graph);
$start = hrtime(true);
$builder = new VisibilityPolygon($compiled);
$compile = (hrtime(true) - $start) / 1e6;
$los = new LineOfSight($compiled);
$times = [];
$vertices = [];
$mismatches = 0;
for ($i = 0; $i < 12; $i++) {
    $origin = ['x' => 200 + ($i % 4) * 1000, 'y' => 300 + intdiv($i, 4) * 1000];
    $start = hrtime(true);
    $polygon = $builder->build($origin, 600, 7500, 6000);
    $times[] = (hrtime(true) - $start) / 1e6;
    $vertices[] = count($polygon);
    foreach ($polygon as $p) {
        if (! $los->point($origin, $p)['visible']) {
            $mismatches++;
        }
    }
}
sort($times);
echo json_encode(['blockers' => 500, 'observers' => 12, 'range' => 600,
    'compileMs' => round($compile, 3), 'medianMs' => round($times[6], 3), 'p95Ms' => round($times[11], 3),
    'maxVertices' => max($vertices), 'boundaryLosMismatches' => $mismatches,
    'peakMiB' => memory_get_peak_usage(true) / 1048576], JSON_PRETTY_PRINT).PHP_EOL;
exit($mismatches ? 1 : 0);
