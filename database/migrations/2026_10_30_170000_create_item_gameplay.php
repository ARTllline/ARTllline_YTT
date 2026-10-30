<?php

use App\Compendium\SrdEquipmentMapper;
use App\Compendium\SrdKeys;
use App\Items\ItemRules;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('item_definitions', function (Blueprint $t) {
            $t->json('gameplay')->nullable();
            $t->foreignId('compendium_entry_id')->nullable()->constrained()->nullOnDelete();
        });
        Schema::table('scene_props', fn (Blueprint $t) => $t->unsignedBigInteger('asset_id')->nullable()->change());
        Schema::create('loot_containers', function (Blueprint $t) {
            $t->id();
            $t->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $t->foreignId('prop_id')->nullable()->unique()->constrained('scene_props')->cascadeOnDelete();
            $t->foreignId('token_id')->nullable()->unique()->constrained()->cascadeOnDelete();
            $t->string('name', 80);
            $t->string('kind', 16)->default('container');
            $t->boolean('is_open')->default(false);
            $t->unsignedInteger('version')->default(0);
            $t->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $t->timestamps();
        });
        Schema::table('inventory_items', function (Blueprint $t) {
            $t->unsignedBigInteger('character_id')->nullable()->change();
            $t->foreignId('loot_container_id')->nullable()->constrained()->cascadeOnDelete();
            $t->string('grip', 8)->default('one');
            $t->string('attack_ability', 8)->default('auto');
            $t->boolean('weapon_proficient')->default(false);
        });
        Schema::create('loot_commands', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $t->uuid('mutation_id');
            $t->string('fingerprint', 64);
            $t->json('result');
            $t->timestamp('created_at');
            $t->unique(['user_id', 'mutation_id']);
        });
        // Upgrade deliberate campaign copies from their immutable local receipts, never live entries.
        foreach (DB::table('compendium_copies')->where('target_type', 'item')->orderBy('id')->get() as $copy) {
            $snapshot = json_decode($copy->snapshot, true);
            $raw = $snapshot['raw_data'] ?? null;
            if (! $raw) {
                continue;
            }
            $n = app(SrdEquipmentMapper::class)->map($raw);
            $n['key'] = SrdKeys::key($raw['index']);
            $mapped = ItemRules::fromCompendium($n);
            $existing = DB::table('item_definitions')->where('id', $copy->target_key)->first();
            if ($existing && json_decode($existing->modifiers, true) !== []) {
                DB::table('item_definitions')->where('id', $copy->target_key)->update(['compendium_entry_id' => $copy->compendium_entry_id]);

                continue;
            }

            DB::table('item_definitions')->where('id', $copy->target_key)->whereNull('gameplay')->update(['gameplay' => json_encode($mapped['gameplay']), 'category' => $mapped['category'], 'equipment_slots' => json_encode($mapped['equipment_slots']), 'max_stack' => $mapped['max_stack'], 'compendium_entry_id' => $copy->compendium_entry_id]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('loot_commands');
        Schema::table('inventory_items', function (Blueprint $t) {
            $t->dropConstrainedForeignId('loot_container_id');
            $t->dropColumn(['grip', 'attack_ability', 'weapon_proficient']);
        });
        Schema::dropIfExists('loot_containers');
        Schema::table('item_definitions', function (Blueprint $t) {
            $t->dropConstrainedForeignId('compendium_entry_id');
            $t->dropColumn('gameplay');
        });
    }
};
