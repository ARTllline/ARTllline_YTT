<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('item_definitions', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $t->string('name', 80);
            $t->string('icon', 48);
            $t->text('description')->nullable();
            $t->string('category', 24);
            $t->string('rarity', 24);
            $t->unsignedTinyInteger('width');
            $t->unsignedTinyInteger('height');
            $t->unsignedSmallInteger('max_stack')->default(1);
            $t->json('equipment_slots');
            $t->json('modifiers');
            $t->uuid('use_ability_id')->nullable();
            $t->timestamps();
        });
        Schema::create('inventory_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('character_id')->constrained()->cascadeOnDelete();
            $t->foreignUuid('item_definition_id')->constrained()->restrictOnDelete();
            $t->unsignedSmallInteger('quantity');
            $t->unsignedTinyInteger('x')->nullable();
            $t->unsignedTinyInteger('y')->nullable();
            $t->string('equipped_slot', 32)->nullable();
            $t->timestamps();
            $t->unique(['character_id', 'equipped_slot']);
        });
        Schema::create('inventory_commands', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->foreignId('character_id')->constrained()->cascadeOnDelete();
            $t->uuid('mutation_id');
            $t->string('fingerprint', 64);
            $t->json('result');
            $t->timestamp('created_at');
            $t->unique(['user_id', 'mutation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_commands');
        Schema::dropIfExists('inventory_items');
        Schema::dropIfExists('item_definitions');
    }
};
