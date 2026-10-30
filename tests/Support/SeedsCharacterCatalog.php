<?php

namespace Tests\Support;

use App\Compendium\CompendiumSync;
use App\Models\CompendiumSource;
use App\Services\CharacterCatalog;

trait SeedsCharacterCatalog
{
    private function seedCharacterCatalog(): void
    {
        $records = json_decode(file_get_contents(base_path('tests/Fixtures/compendium/character-catalog.json')), true, 512, JSON_THROW_ON_ERROR);
        app(CompendiumSync::class)->import(CompendiumSource::where('key', 'srd-2024')->firstOrFail(), $records, ['skills', 'conditions', 'rules']);
        $this->app->forgetInstance(CharacterCatalog::class);
    }
}
