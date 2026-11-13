<?php

namespace Tests\Feature;

use App\Actions\SpellLibrary;
use App\Compendium\CompendiumContent;
use App\Compendium\CompendiumSync;
use App\Compendium\LocalVisualPack;
use App\Models\Asset;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\CompendiumVisual;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class LocalVisualPackTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    private array $details = [];

    private array $rows = [];

    private string $sha;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('campaigns');
        $this->root = storage_path('framework/testing/visual-'.Str::uuid());
        File::makeDirectory($this->root.'/data', 0755, true);
        File::makeDirectory($this->root.'/assets');
        $image = UploadedFile::fake()->image('synthetic.png', 64, 64);
        $this->sha = hash_file('sha256', $image->getRealPath());
        copy($image->getRealPath(), $this->root.'/assets/'.$this->sha.'.png');
        $records = [];
        foreach (['equipment/longsword', 'equipment/shield', 'spells/fireball'] as $path) {
            $raw = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/'.str_replace('/', '-', $path).'.json')), true);
            $kind = str_starts_with($path, 'spells/') ? 'spell' : 'equipment';
            $id = 'srd:'.$kind.':'.$raw['index'].':2024';
            $records[] = ['endpoint' => explode('/', $path)[0], 'data' => $raw];
            $this->rows[] = ['id' => $id, 'source' => '2024', 'kind' => $kind, 'shard' => '0', 'icon' => 'assets/'.$this->sha.'.png'];
            $this->details[$id] = ['record' => ['stable_version_id' => substr($id, 4), 'edition' => '2024',
                'source' => ['index' => $raw['index'], 'commit' => str_repeat('a', 40)],
                'icon' => ['path' => 'icons/test.png', 'sha256' => $this->sha, 'icon_id' => 'SYNTHETIC_TEST_ONLY'],
                'icon_review' => ['required' => false, 'review_status' => 'preserved_compatible_exact']],
                'assets' => ['icons/test.png' => 'assets/'.$this->sha.'.png']];
        }
        app(CompendiumSync::class)->import(CompendiumSource::firstOrFail(), $records, CompendiumSync::TYPES);
        $this->writeExport();
    }

    protected function tearDown(): void
    {
        if (isset($this->root)) {
            File::deleteDirectory($this->root);
        }
        parent::tearDown();
    }

    private function writeExport(): void
    {
        file_put_contents($this->root.'/data/index.js', 'acceptIndex('.json_encode(['schemaVersion' => 1,
            'inputSchemas' => ['srd' => 2], 'srdCommit' => str_repeat('a', 40), 'records' => $this->rows]).');');
        file_put_contents($this->root.'/data/records-0.js', 'acceptShard.bind(null,"0")('.json_encode($this->details).');');
    }

    public function test_install_deduplicates_repeats_and_preserves_source_and_existing_copies(): void
    {
        $pack = app(LocalVisualPack::class);
        $user = User::factory()->create();
        $this->actingAs($user);
        $e = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $oldCopy = app(CompendiumContent::class)->item($e)->toArray();
        $before = CompendiumEntry::orderBy('id')->get()->map->getRawOriginal()->all();
        $this->assertSame(3, $pack->run($this->root)['counts']['create']);
        $this->assertDatabaseCount('assets', 0);
        $this->assertSame(3, $pack->run($this->root, true)['counts']['linked']);
        $this->assertDatabaseCount('assets', 1);
        $this->assertDatabaseCount('compendium_visuals', 3);
        $asset = Asset::firstOrFail();
        $this->assertSame('asset:'.$asset->id, app(CompendiumContent::class)->item($e->fresh())->icon);
        $spell = CompendiumEntry::where('entity_type', 'spells')->firstOrFail();
        $this->assertSame('asset:'.$asset->id, app(SpellLibrary::class)->template($spell)['icon']);
        $newCopy = app(CompendiumContent::class)->item($e->fresh())->toArray();
        $this->assertSame(3, $pack->run($this->root, true)['counts']['skip']);
        $this->assertSame($before, CompendiumEntry::orderBy('id')->get()->map->getRawOriginal()->all());
        $this->assertSame('item_sword', $oldCopy['icon']);
        $this->get('/api/assets/'.$asset->id.'/thumbnail')->assertOk();
        $this->patchJson('/api/assets/'.$asset->id, ['name' => 'mutate'])->assertForbidden();
        $this->deleteJson('/api/assets/'.$asset->id)->assertForbidden();
        $this->actingAs(User::factory()->create())->get('/api/assets/'.$asset->id.'/thumbnail')->assertOk();
        $this->assertSame(3, $pack->detach());
        $this->assertSame($newCopy['icon'], 'asset:'.$asset->id);
        $this->assertSame($oldCopy['icon'], app(CompendiumContent::class)->item($e->fresh())->icon);
        $this->get('/api/assets/'.$asset->id.'/thumbnail')->assertOk();
        $this->assertSame(3, $pack->run($this->root, true)['counts']['create']);
        $this->assertDatabaseCount('assets', 1);
    }

    public function test_doubtful_images_stay_neutral_and_source_id_does_not_use_names(): void
    {
        $this->details['srd:equipment:longsword:2024']['record']['icon_review'] = ['required' => true, 'review_status' => 'reviewed_doubtful'];
        $this->details['srd:equipment:shield:2024']['record']['icon_review']['decision'] = 'rejected';
        $this->writeExport();
        $result = app(LocalVisualPack::class)->run($this->root, true);
        $this->assertSame(1, $result['counts']['linked']);
        $this->assertSame(2, $result['counts']['unlinked']);
        $entry = CompendiumEntry::where('external_key', 'longsword')->firstOrFail();
        $this->assertNull($entry->visualIcon());
        $spell = CompendiumEntry::where('entity_type', 'spells')->firstOrFail();
        $spell->update(['name' => 'Completely unrelated display name']);
        $this->assertSame(1, app(LocalVisualPack::class)->run($this->root)['counts']['skip']);
        $spell->update(['checksum' => str_repeat('b', 64)]);
        $this->assertNull($spell->fresh()->visualIcon());
    }

    public function test_corrupt_or_traversing_images_fail_before_any_write(): void
    {
        file_put_contents($this->root.'/assets/'.$this->sha.'.png', 'bad image');
        try {
            app(LocalVisualPack::class)->run($this->root, true);
            $this->fail('Corrupt image accepted');
        } catch (\InvalidArgumentException) {
            $this->assertDatabaseCount('assets', 0);
            $this->assertDatabaseCount('compendium_visuals', 0);
        }
        $this->rows[0]['icon'] = '../outside.png';
        $this->writeExport();
        $this->expectException(\InvalidArgumentException::class);
        app(LocalVisualPack::class)->run($this->root, true);
    }

    public function test_private_assets_are_still_denied_to_unrelated_users(): void
    {
        $owner = User::factory()->create();
        $asset = Asset::create(['uploaded_by' => $owner->id, 'library_user_id' => $owner->id,
            'kind' => 'prop', 'name' => 'Private', 'original_name' => 'private.png', 'storage_path' => 'private.png',
            'mime_type' => 'image/png', 'file_size' => 1, 'width' => 1, 'height' => 1]);
        $this->actingAs(User::factory()->create())->getJson('/api/assets/'.$asset->id.'/thumbnail')->assertForbidden();
        $this->getJson('/api/assets/'.$asset->id)->assertForbidden();
    }

    public function test_failed_installation_rolls_back_bindings_and_its_new_files(): void
    {
        $event = 'eloquent.creating: '.CompendiumVisual::class;
        $created = 0;
        Event::listen($event, function () use (&$created) {
            if (++$created === 2) {
                throw new \RuntimeException('Simulated installation failure');
            }
        });
        try {
            app(LocalVisualPack::class)->run($this->root, true);
            $this->fail('Expected installation failure');
        } catch (\RuntimeException $e) {
            $this->assertSame('Simulated installation failure', $e->getMessage());
            $this->assertDatabaseCount('assets', 0);
            $this->assertDatabaseCount('compendium_visuals', 0);
            $this->assertSame([], Storage::disk('campaigns')->allFiles());
        } finally {
            Event::forget($event);
        }
    }

    public function test_large_catalog_keeps_page_payload_and_visual_queries_bounded(): void
    {
        app(LocalVisualPack::class)->run($this->root, true);
        $template = CompendiumEntry::where('external_key', 'longsword')->firstOrFail()->getRawOriginal();
        unset($template['id']);
        $rows = [];
        for ($i = 0; $i < 1200; $i++) {
            $rows[] = array_replace($template, ['external_key' => 'synthetic-'.$i, 'slug' => 'synthetic-'.$i, 'name' => 'Synthetic '.$i]);
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            DB::table('compendium_entries')->insert($chunk);
        }
        $this->actingAs(User::factory()->create());
        DB::enableQueryLog();
        try {
            $response = $this->getJson('/api/library/items/compendium?page=25')->assertOk()->assertJsonCount(24, 'entries')->assertJsonPath('total', 1202);
            $queries = DB::getQueryLog();
            $this->assertLessThanOrEqual(10, count($queries), 'Catalog must not query an icon per row');
            $this->assertLessThan(250000, strlen($response->getContent()));
        } finally {
            DB::disableQueryLog();
        }
    }
}
