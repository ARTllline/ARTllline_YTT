<?php

use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedReview;
use App\Items\ItemRules;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Services\CharacterGameplay;
use App\Spells\SpellProjection;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

// Dedicated read-only audit. No writer, migrations, confirmations or game commands.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$options = getopt('', ['root:', 'output:']);
if (empty($options['root']) || empty($options['output'])) {
    throw new InvalidArgumentException('Explicit --root and --output (new report file) required.');
}
if (file_exists($options['output'])) {
    throw new InvalidArgumentException('Report already exists.');
}
$queries = 0;
DB::connection()->beforeExecuting(function ($sql) use (&$queries) {
    if (! preg_match('/^select\s/i', ltrim($sql))) {
        throw new RuntimeException('Non-SELECT SQL refused before execution.');
    }
    $queries++;
});
$manifestPath = resource_path('data/content/srd-2024-pilot.manifest.json');
$manifest = json_decode(file_get_contents($manifestPath), true, 128, JSON_THROW_ON_ERROR);
$previous = json_decode(file_get_contents(base_path('docs/CONTENT_03_LIVE_DIFF.json')), true, 128, JSON_THROW_ON_ERROR);
$sourceId = CompendiumSource::where('key', 'srd-2024')->value('id');
$keys = array_column($manifest['selection'], 'external_key');
$entries = CompendiumEntry::where('source_id', $sourceId)->whereIn('external_key', $keys)->get()->keyBy('id');
$ids = $entries->keys()->all();
$definitions = fn () => DB::table('item_definitions')->whereIn('compendium_entry_id', $ids)->orderBy('id')->get();
$characters = fn () => Character::query()->where(function ($q) use ($ids) {
    foreach ($ids as $id) {
        $q->orWhereJsonContains('abilities', [['spell' => ['source_entry_id' => $id]]]);
    }
})->orderBy('id')->get(['id', 'abilities']);
$state = function () use ($sourceId, $keys, $ids, $definitions, $characters) {
    $defs = $definitions();

    return [
        'source' => DB::table('compendium_sources')->where('id', $sourceId)->first(),
        'entries' => DB::table('compendium_entries')->where('source_id', $sourceId)->whereIn('external_key', $keys)->orderBy('id')->get(),
        'copies' => DB::table('compendium_copies')->whereIn('compendium_entry_id', $ids)->orderBy('id')->get(),
        'definitions' => $defs,
        'inventory' => DB::table('inventory_items')->whereIn('item_definition_id', $defs->pluck('id'))->orderBy('id')->get(),
        'characters' => $characters()->toArray(),
        'conditions' => DB::table('token_conditions')->whereIn('compendium_entry_id', $ids)->orderBy('id')->get(),
        'assets_count' => DB::table('assets')->count(),
    ];
};
$before = hash('sha256', json_encode($state(), JSON_THROW_ON_ERROR));
$plan = app(UnifiedDryRun::class)->run($options['root'], $manifestPath);
$copies = DB::table('compendium_copies')->whereIn('compendium_entry_id', $ids)->get(['compendium_entry_id']);
$defs = $definitions();
$inventory = DB::table('inventory_items')->whereIn('item_definition_id', $defs->pluck('id'))->get(['item_definition_id']);
$characterRows = $characters();
$diff = function (array $a, array $b): array {
    $result = [];
    foreach (array_unique([...array_keys($a), ...array_keys($b)]) as $key) {
        if (array_key_exists($key, $a) !== array_key_exists($key, $b) || UnifiedReview::digest($a[$key] ?? null) !== UnifiedReview::digest($b[$key] ?? null)) {
            $result[$key] = ['before' => $a[$key] ?? null, 'after' => $b[$key] ?? null];
        }
    }

    return $result;
};
$decisions = [];
foreach ($plan['records'] as $i => $row) {
    $entry = $entries->get($row['existing_entry_id']);
    $n = $row['normalized'];
    $old = $previous['records'][$i];
    $assessment = $row['baseline_assessment'];
    $mechanics = $projection = $validationErrors = [];
    $abilityCount = 0;
    $referenceChanges = [];
    if ($entry && $entry->entity_type === 'spells') {
        $a = app(SpellProjection::class)->ability($entry->normalized_data + ['source_key' => $entry->external_key, 'source_entry_id' => $entry->id], 0);
        $b = app(SpellProjection::class)->ability($n + ['source_key' => $entry->external_key, 'source_entry_id' => $entry->id], 0);
        $validationErrors = Validator::make(['abilities' => [$b]], CharacterGameplay::rules())->errors()->all();
        unset($a['id'], $b['id']);
        $referenceChanges = $diff(['description' => $a['description'], 'reference' => $a['spell']['reference']], ['description' => $b['description'], 'reference' => $b['spell']['reference']]);
        unset($a['description'], $b['description'], $a['spell']['reference'], $b['spell']['reference']);
        $mechanics = $diff($a, $b);
        $projection = $diff(array_diff_key($entry->normalized_data, ['content' => true]), array_diff_key($n, ['content' => true]));
        foreach ($characterRows as $character) {
            $abilityCount += count(array_filter($character->abilities ?? [], fn ($ability) => data_get($ability, 'spell.source_entry_id') === $entry->id));
        }
    } elseif ($entry) {
        $a = ItemRules::fromCompendium($entry->normalized_data);
        $b = ItemRules::fromCompendium($n);
        unset($a['gameplay']['use']['ability']['id'], $b['gameplay']['use']['ability']['id']);
        $mechanics = $diff($a, $b);
        $projection = $diff($entry->normalized_data, array_diff_key($n, ['content' => true]));
    }
    $decisions[] = [
        ...array_intersect_key($row, array_flip(['id', 'existing_entry_id', 'identity', 'action', 'reason', 'baseline', 'baseline_assessment', 'source_checksum', 'checksum', 'projection_checksum', 'gates', 'coverage'])),
        'recommended_decision' => $entry ? 'update' : 'create',
        'until_approved' => $entry ? 'preserve' : 'do_not_create',
        'content_approval' => 'pending', 'baseline_approval' => $assessment['status'] === 'legacy-equipment-missing-null-ammunition-v1' ? 'pending' : 'not_required',
        'source_checksum_unchanged_since_content_03' => $row['source_checksum'] === $old['source_checksum'],
        'content_checksum_unchanged_since_content_03' => $row['checksum'] === $old['checksum'],
        'previous_projection_checksum' => $old['projection_checksum'],
        'projection_checksum_changed' => $row['projection_checksum'] !== $old['projection_checksum'],
        'existing_baseline_unchanged_since_content_03' => $row['baseline'] === $old['baseline'],
        'correction_fields' => array_keys($manifest['selection'][$i]['correction']['fields'] ?? []),
        'projection_changes' => $projection,
        'future_consumer_mechanical_changes' => $mechanics,
        'future_consumer_reference_changes' => $referenceChanges,
        'future_ability_validation_errors' => $validationErrors,
        'references' => ['compendium_copies' => $copies->where('compendium_entry_id', $entry?->id)->count(),
            'item_definitions' => $defs->where('compendium_entry_id', $entry?->id)->count(),
            'inventory_rows' => $inventory->whereIn('item_definition_id', $defs->where('compendium_entry_id', $entry?->id)->pluck('id'))->count(),
            'character_abilities_by_entry_id' => $abilityCount],
    ];
}
$after = hash('sha256', json_encode($state(), JSON_THROW_ON_ERROR));
if ($before !== $after) {
    throw new RuntimeException('Catalog or linked snapshots changed during read-only audit. Regenerate the report.');
}
$result = ['generated_at' => now()->setTimezone('Europe/Kiev')->toIso8601String(),
    'verification' => ['database_writes' => 0, 'only_select_queries' => true, 'query_count' => $queries, 'before_after_equal' => true, 'baseline_digest' => $before],
    'live_diff' => $plan, 'decisions' => $decisions];
$handle = fopen($options['output'], 'xb');
if (! $handle) {
    throw new RuntimeException('Output must be a new writable report.');
}
try {
    $json = json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
    if (fwrite($handle, $json) !== strlen($json)) {
        throw new RuntimeException('Incomplete report.');
    }
} finally {
    fclose($handle);
}
echo json_encode(['actions' => $plan['actions'], 'plan_checksum' => $plan['plan_checksum'], 'verification' => $result['verification']], JSON_PRETTY_PRINT)."\n";
foreach ($decisions as $row) {
    echo $row['id'].' | '.($row['existing_entry_id'] ?? 'new').' | '.$row['action'].' | '.json_encode($row['references']).' | mechanical changes='.count($row['future_consumer_mechanical_changes'])."\n";
}
