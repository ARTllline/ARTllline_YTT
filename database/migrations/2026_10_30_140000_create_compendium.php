<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('compendium_sources', function (Blueprint $t) {
            $t->id();
            $t->string('key', 64)->unique();
            $t->string('name');
            $t->string('version', 48);
            $t->string('license', 48);
            $t->string('source_url');
            $t->json('metadata');
            $t->timestamp('last_synced_at')->nullable();
            $t->json('type_synced_at')->nullable();
            $t->timestamps();
        });
        Schema::create('compendium_entries', function (Blueprint $t) {
            $t->id();
            $t->foreignId('source_id')->constrained('compendium_sources')->restrictOnDelete();
            $t->string('entity_type', 32);
            $t->string('external_key', 160);
            $t->string('slug', 160)->index();
            $t->string('name')->index();
            $t->json('raw_data');
            $t->json('normalized_data');
            $t->string('checksum', 64);
            $t->unsignedInteger('normalization_version');
            $t->timestamp('imported_at');
            $t->timestamps();
            $t->unique(['source_id', 'entity_type', 'external_key'], 'compendium_identity');
            $t->index(['entity_type', 'name']);
            $t->index(['source_id', 'entity_type', 'name']);
        });
        // Immutable import receipts retain unsupported mechanics independently of editable content.
        Schema::create('compendium_copies', function (Blueprint $t) {
            $t->id();
            $t->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $t->foreignId('compendium_entry_id')->constrained()->restrictOnDelete();
            $t->foreignId('character_id')->nullable()->constrained()->cascadeOnDelete();
            $t->string('target_type', 32);
            $t->string('target_key', 64);
            $t->string('source_checksum', 64);
            $t->json('source_reference');
            $t->json('snapshot');
            $t->timestamp('created_at');
            $t->index(['campaign_id', 'target_type', 'target_key']);
        });
        DB::table('compendium_sources')->insert([
            'key' => 'srd-2024', 'name' => 'SRD 5.2.1 / D&D 2024', 'version' => '5.2.1',
            'license' => 'CC-BY-4.0', 'source_url' => 'https://www.dndbeyond.com/srd',
            'metadata' => json_encode([
                'api_url' => 'https://www.dnd5eapi.co/api/2024', 'api_ruleset' => 'SRD 5.2 (mutable; not a pinned 5.2.1 release)',
                'canonical_reference' => 'SRD_CC_v5.2.1.pdf',
                'license_url' => 'https://creativecommons.org/licenses/by/4.0/legalcode',
                'attribution' => 'This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
            ]), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('compendium_copies');
        Schema::dropIfExists('compendium_entries');
        Schema::dropIfExists('compendium_sources');
    }
};
