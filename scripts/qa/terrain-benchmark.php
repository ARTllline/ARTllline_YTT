<?php

use App\Services\TerrainBrush;

// No application boot, credentials or database. Benchmark only the deterministic CPU brush.
require __DIR__.'/../../vendor/autoload.php';

$brush = new TerrainBrush;
$results = [];
foreach ([32, 180, 512, 1024] as $size) {
    $stroke = ['size' => $size, 'softness' => 180, 'strength' => 200, 'operation' => 'paint', 'materialVersionId' => '1',
        'points' => [['x' => 256, 'y' => 256], ['x' => 1000, 'y' => 700]]];
    $times = [];
    for ($i = 0; $i < 7; $i++) {
        $start = hrtime(true);
        $coverage = $brush->coverage($stroke, 2048, 2048);
        $bytes = 0;
        foreach ($coverage as $mask) {
            $layers = $brush->apply([], $mask, $stroke);
            foreach ($layers as $layer) {
                $bytes += strlen(gzcompress($layer, 6));
            }
        }
        $times[] = (hrtime(true) - $start) / 1000000;
    }
    sort($times);
    $results[] = ['diameter' => $size, 'medianMs' => round($times[3], 2), 'p95Ms' => round($times[6], 2),
        'chunks' => count($coverage), 'compressedMaskBytes' => $bytes];
}
$golden = ['size' => 100, 'softness' => 180, 'strength' => 173,
    'points' => [['x' => 240.25, 'y' => 249.5], ['x' => 280.5, 'y' => 280.25]]];
$hashes = [];
foreach ($brush->coverage($golden, 1024, 1024) as $key => $mask) {
    $hashes[$key] = hash('sha256', $mask);
}
$report = ['brush' => $results, 'goldenCoverage' => $hashes];
if (in_array('--capacity', $argv, true)) {
    $points = [];
    for ($y = 128; $y < 4096; $y += 256) {
        $row = [['x' => 128, 'y' => $y], ['x' => 3968, 'y' => $y]];
        array_push($points, ...((count($points) / 2) % 2 ? array_reverse($row) : $row));
    }
    $stroke = ['size' => 512, 'softness' => 80, 'strength' => 180, 'operation' => 'paint',
        'materialVersionId' => '1', 'points' => $points];
    $start = hrtime(true);
    $coverage = $brush->coverage($stroke, 4096, 4096);
    $rasterMs = (hrtime(true) - $start) / 1000000;
    $layers = array_fill(1, 8, str_repeat(chr(31), 16384));
    $start = hrtime(true);
    $compressed = 0;
    foreach ($coverage as $mask) {
        foreach ($brush->apply($layers, $mask, $stroke) as $layer) {
            $compressed += strlen(gzcompress($layer, 6));
        }
    }
    $report['capacity'] = ['chunks' => count($coverage), 'layersPerChunk' => count($layers),
        'rasterMs' => round($rasterMs, 2), 'applyAndCompressMs' => round((hrtime(true) - $start) / 1000000, 2),
        'compressedBytes' => $compressed, 'peakPhpBytes' => memory_get_peak_usage(true)];
}
echo json_encode($report, JSON_PRETTY_PRINT).PHP_EOL;
