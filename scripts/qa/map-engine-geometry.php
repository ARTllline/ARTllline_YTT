<?php

// Read-only real-scene geometry benchmark. No writes or HTTP/presentation timing.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
abort_unless(app()->environment('local'), 403);
$scene = App\Models\Scene::findOrFail(10);
$compiled = App\Services\StructuralGeometry::forScene($scene);
$builder = new App\Services\VisibilityPolygon($compiled);
$times = $hashes = $sizes = [];
for ($repeat = 0; $repeat < 4; $repeat++) {
    for ($i = 0; $i < 20; $i++) {
        $origin = ['x' => 570 + $i * 11, 'y' => 830];
        $start = hrtime(true);
        $polygon = $builder->build($origin, 600, $scene->width, $scene->height);
        $times[] = (hrtime(true) - $start) / 1e6;
        $hashes[$i] = hash('sha256', json_encode($polygon, JSON_THROW_ON_ERROR));
        $sizes[$i] = count($polygon);
    }
}
sort($times);
$report = ['shapes' => count($compiled['shapes']), 'n' => count($times), 'medianMs' => $times[40], 'p95Ms' => $times[76], 'maxMs' => max($times), 'hashes' => $hashes, 'vertices' => $sizes, 'peakMiB' => memory_get_peak_usage(true) / 1048576];
$path = $argv[1] ?? 'artifacts/map-engine-performance/geometry-current.json';
file_put_contents($path, json_encode($report, JSON_PRETTY_PRINT));
unset($report['hashes'], $report['vertices']);
echo json_encode($report).PHP_EOL;
