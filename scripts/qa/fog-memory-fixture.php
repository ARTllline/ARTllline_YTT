<?php

use App\Models\Campaign;
use App\Models\Scene;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

// Reversible QA of the existing Scene 7 only. No accounts/entities are created.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
abort_unless(app()->environment('local'), 403);
$file = storage_path('app/map09-memory.private.json');
DB::transaction(function () use ($argv, $file) {
    Campaign::whereKey(5)->lockForUpdate()->firstOrFail();
    $scene = Scene::whereKey(7)->where('campaign_id', 5)->lockForUpdate()->firstOrFail();
    $query = DB::table('fog_memories')->where('scene_id', 7);
    if (($argv[1] ?? '') === 'backup') {
        if (file_exists($file)) {
            throw new RuntimeException('Unrestored fog backup exists; restore it before another QA run.');
        }
        file_put_contents($file, json_encode(['memories' => $query->get()->map(fn ($row) => (array) $row)->all(),
            'manual' => $scene->fogActions()->get()->map(fn ($row) => $row->getAttributes())->all(), 'base' => $scene->fog_base], JSON_THROW_ON_ERROR));
    } elseif (($argv[1] ?? '') === 'restore') {
        $rows = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        $query->delete();
        foreach ($rows['memories'] ?? $rows as $row) {
            DB::table('fog_memories')->insert($row);
        }
        if (isset($rows['manual'])) {
            $scene->fogActions()->delete();
            foreach ($rows['manual'] as $row) {
                $scene->fogActions()->getRelated()->getConnection()->table($scene->fogActions()->getRelated()->getTable())->insert($row);
            }
            $scene->forceFill(['fog_base' => $rows['base']])->save();
        }
    } else {
        throw new InvalidArgumentException('Use backup or restore');
    }
});
if (($argv[1] ?? '') === 'restore') {
    unlink($file);
}
echo "Fog memory fixture {$argv[1]} OK\n";
