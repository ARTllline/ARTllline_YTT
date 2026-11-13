<?php

namespace Tests\Support;

use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedSrdAdapter;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Tests\TestCase;

abstract class UnifiedCompendiumTestCase extends TestCase
{
    use DatabaseMigrations;

    protected string $root;

    protected array $details = [];

    protected array $manifest;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = storage_path('framework/testing/unified-'.Str::uuid());
        File::makeDirectory($this->root.'/data', 0755, true);
        $commit = str_repeat('a', 40);
        $selection = [];
        foreach (['equipment/longsword', 'equipment/shield', 'spells/fireball'] as $path) {
            $raw = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/'.str_replace('/', '-', $path).'.json')), true, 128, JSON_THROW_ON_ERROR);
            $kind = str_starts_with($path, 'spells/') ? 'spell' : 'equipment';
            $key = $raw['index'];
            $id = 'srd:'.$kind.':'.$key.':2024';
            $this->details[$id] = ['record' => ['edition' => '2024', 'stable_version_id' => $kind.':'.$key.':2024',
                'name_en' => $raw['name'], 'name_ru' => 'Тест · '.$raw['name'], 'description_en' => $raw['description'] ?? $raw['desc'] ?? [], 'description_ru' => null,
                'source' => ['index' => $key, 'commit' => $commit, 'rules_reference' => 'SRD 5.2/5.2.1; unpinned', 'url' => 'https://www.dnd5eapi.co'.$raw['url']],
                'raw' => $raw, 'icon' => null, 'import_review' => ['approved' => false, 'automation_allowed' => false],
                'localization' => ['human_verified' => false], 'rules_audit' => ['full_semantic_review' => false]],
                'group' => ['id' => $kind.':'.$key], 'assets' => []];
            $selection[] = ['id' => $id, 'kind' => $kind, 'entity_type' => match ($key) {
                'longsword' => 'weapons', 'shield' => 'armor', default => 'spells'
            },
                'external_key' => $key, 'checksum' => UnifiedSrdAdapter::checksum($this->details[$id])];
        }
        $this->manifest = ['format' => 1, 'adapter_version' => UnifiedSrdAdapter::VERSION, 'source' => 'srd-2024', 'ruleset' => 'dnd-2024',
            'export' => ['srd_commit' => $commit, 'library_version' => 'test-fixture'], 'selection' => $selection, 'reviews' => []];
        $this->writePackage();
    }

    protected function tearDown(): void
    {
        // Only the random fixture directory created above, never campaign data.
        if (isset($this->root) && str_starts_with($this->root, storage_path('framework/testing/unified-'))) {
            File::deleteDirectory($this->root);
        }
        parent::tearDown();
    }

    protected function writePackage(bool $repin = true): void
    {
        $index = [];
        foreach ($this->manifest['selection'] as &$selected) {
            $detail = $this->details[$selected['id']];
            if ($repin) {
                $selected['checksum'] = UnifiedSrdAdapter::checksum($detail);
            }
            $index[] = ['id' => $selected['id'], 'source' => '2024', 'originalId' => $detail['record']['stable_version_id'],
                'kind' => $selected['kind'], 'en' => $detail['record']['name_en'], 'ru' => $detail['record']['name_ru'],
                'group' => $detail['group']['id'], 'icon' => $detail['record']['icon'] ? array_values($detail['assets'])[0] : null, 'shard' => '0'];
        }
        $json = fn ($data) => json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        file_put_contents($this->root.'/manifest.json', $json($this->manifest));
        file_put_contents($this->root.'/data/index.js', 'acceptIndex('.$json(['schemaVersion' => 1, 'inputSchemas' => ['srd' => 2],
            'srdCommit' => $this->manifest['export']['srd_commit'], 'srdLibraryVersion' => $this->manifest['export']['library_version'], 'records' => $index]).');');
        file_put_contents($this->root.'/data/records-0.js', 'acceptShard.bind(null,"0")('.$json($this->details).');');
    }

    protected function runPlan(bool $offline = false): array
    {
        return app(UnifiedDryRun::class)->run($this->root, $this->root.'/manifest.json', $offline);
    }

    protected function reviewEvidence(string $id): array
    {
        $row = collect($this->runPlan(true)['records'])->firstWhere('id', $id);

        return ['confirmed' => true, 'confirmed_at' => '2026-11-12T12:00:00+00:00', 'languages' => ['en', 'ru'], 'projection_checksum' => $row['projection_checksum']];
    }
}
