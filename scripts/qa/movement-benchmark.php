<?php

require __DIR__.'/../../vendor/autoload.php';

use App\Models\SceneProp;
use App\Services\MovementCollision;
use App\Services\StructuralGeometry;

$fixture = json_decode(file_get_contents(__DIR__.'/../../tests/Fixtures/movement.json'), true, flags: JSON_THROW_ON_ERROR);
$props = [];
$graph = ['edges' => [], 'vertices' => []];
for ($i = 0; $i < 400; $i++) {
    $x = 100 + $i % 20 * 240;
    $y = 100 + intdiv($i, 20) * 240;
    $case = $fixture['props'][$i % count($fixture['props'])];
    $props[] = (new SceneProp)->forceFill(['id' => $i + 1, 'x' => $x, 'y' => $y, 'rotation' => $case['rotation'],
        'scale_x' => $case['scaleX'], 'scale_y' => $case['scaleY'],
        'preset_snapshot' => ['width' => 100, 'height' => 100, 'pivotX' => 0.5, 'pivotY' => 0.5,
            'collider' => $case['collider'] + ['blocksMovement' => true]]]);
    $graph['vertices'][] = ['id' => "a$i", 'x' => $x, 'y' => $y + 90];
    $graph['vertices'][] = ['id' => "b$i", 'x' => $x + 85, 'y' => $y + 90];
    $graph['edges'][] = array_replace($fixture['graph']['edges'][0], ['id' => "wall$i", 'a' => "a$i", 'b' => "b$i"]);
}
$collision = new MovementCollision;
$cached = StructuralGeometry::compile($graph, $props)['shapes'];
foreach ([false, true] as $compile) {
    $times = [];
    for ($i = 0; $i < 300; $i++) {
        $y = 230 + intdiv($i % 400, 20) * 240;
        $start = hrtime(true);
        $shapes = $compile ? StructuralGeometry::compile($graph, $props)['shapes'] : $cached;
        if ($collision->blocks(['x' => 0, 'y' => $y], ['x' => 4900, 'y' => $y], 15, $shapes)) {
            throw new RuntimeException('Expected a clear corridor.');
        }
        $times[] = (hrtime(true) - $start) / 1e6;
    }
    sort($times);
    printf("%s (%d obstacles, %d sweeps): p50 %.3f ms, p95 %.3f ms\n",
        $compile ? 'compile + sweep' : 'sweep', count($cached), count($times), $times[149], $times[284]);
}
