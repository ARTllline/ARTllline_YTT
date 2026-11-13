<?php

namespace Tests\Feature;

use App\Actions\ItemLibrary;
use App\Actions\SpellLibrary;
use App\Compendium\Unified\UnifiedCatalogPlan;
use App\Compendium\Unified\UnifiedPackage;
use App\Compendium\Unified\UnifiedSrdAdapter;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\UnifiedCompendiumTestCase;

/** Optional complete local export integration, with simulated trust ONLY inside SQLite :memory:. */
class UnifiedMassConsumersTest extends UnifiedCompendiumTestCase
{
    public function test_every_prepared_record_can_use_existing_libraries_without_losing_reference_or_enabling_execution(): void
    {
        $root = getenv('YTT_CONTENT07_SOURCE');
        if (! $root) {
            $this->markTestSkipped('Set YTT_CONTENT07_SOURCE for the pinned local export integration.');
        }
        $this->assertSame('sqlite', DB::connection()->getDriverName());
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $user = User::factory()->create();
        $source = CompendiumSource::where('key', 'srd-2024')->firstOrFail();
        $adapter = app(UnifiedSrdAdapter::class);
        $items = app(ItemLibrary::class);
        $spells = app(SpellLibrary::class);
        $counts = $rarities = $ids = [];
        $files = glob(resource_path('data/content/srd-2024-bulk-07/part-*.manifest.json'));
        $this->assertCount(40, $files);
        foreach ($files as $file) {
            $package = app(UnifiedPackage::class)->read($root, $file);
            foreach ($package['records'] as $input) {
                $manifest = $package['manifest'];
                $this->assertSame([], $manifest['reviews']);
                $data = $adapter->prepare($input, $manifest, $root);
                $this->assertFalse($data['gates']['copy']);
                $manifest['reviews'] = [['id' => $input['selection']['id'], 'checksum' => $data['checksum'],
                    'projection_checksum' => $data['projection_checksum'], 'confirmed' => true,
                    'reviewer' => 'AUTOMATED SQLite simulation, NOT human approval', 'evidence' => 'Structural consumer test only, NOT semantic review or import authorization',
                    'confirmed_at' => now()->toIso8601String(), 'languages' => ['en', 'ru'], 'browse' => true, 'copy' => true, 'execute' => false]];
                $data = $adapter->prepare($input, $manifest, $root);
                $entry = CompendiumEntry::create(array_intersect_key($data, array_flip(UnifiedCatalogPlan::FIELDS))
                    + ['source_id' => $source->id, 'slug' => Str::slug($data['name']), 'imported_at' => now()]);
                $before = $entry->fresh()->getAttributes();
                if ($data['entity_type'] === 'spells') {
                    $ability = $spells->template($entry);
                    $result = $spells->save($user, ['copyFrom' => $entry->id, 'ability' => $ability]);
                    $copy = $result['entry']['ability'];
                    $content = $copy['spell']['content'];
                    $this->assertSame('MANUAL', $copy['spell']['coverage']);
                    $this->assertSame('nothing', $copy['result']['type']);
                    $this->assertNull($copy['damage']);
                    $this->assertEmpty($copy['spell']['effects']);
                    $this->assertSame($data['normalized_data']['components'], $copy['spell']['components']);
                    $this->assertSame($data['normalized_data']['range']['text'], $content['range_text']);
                } else {
                    $result = $items->copyCompendium($user, $entry->id);
                    $copy = $result['definition'];
                    $content = $copy['content'];
                    $this->assertSame([], $copy['equipment_slots']);
                    $this->assertSame([], $copy['modifiers']);
                    $this->assertEmpty($copy['gameplay']['weapon'] ?? null);
                    $this->assertSame($data['entity_type'], $content['catalog_type']);
                    $rarities[$copy['rarity']] = ($rarities[$copy['rarity']] ?? 0) + 1;
                }
                $this->assertFalse($content['gates']['execute']);
                $this->assertSame($data['normalized_data']['description'], $content['reference']);
                $this->assertSame($data['normalized_data']['content']['languages']['ru'], $content['localized']);
                $this->assertSame($before, $entry->fresh()->getAttributes());
                $kind = $input['selection']['kind'];
                $counts[$kind] = ($counts[$kind] ?? 0) + 1;
                $ids[] = $input['selection']['id'];
            }
        }
        $this->assertCount(797, array_unique($ids));
        $this->assertSame(['equipment' => 189, 'magic_item' => 276, 'spell' => 332], $counts);
        $this->assertDatabaseCount('library_items', 465);
        $report = ['scope' => 'ALL 797 real source records, SQLite :memory: ONLY; simulated trust is NOT human approval',
            'counts' => $counts, 'rarities' => $rarities, 'live_database_writes' => 0, 'human_approvals' => 0, 'execute' => false, 'ids' => $ids];
        file_put_contents(base_path('artifacts/content-07-consumers.json'), json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n");
    }

    protected function tearDown(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite' && DB::connection()->getDatabaseName() === ':memory:') {
            DB::table('compendium_copies')->delete();
            DB::table('library_items')->delete();
            CompendiumEntry::whereNotNull('library_user_id')->delete();
        }
        parent::tearDown();
    }
}
