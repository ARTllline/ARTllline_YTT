<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('characters', function (Blueprint $t) {
            $t->json('spellcasting')->nullable();
            $t->unsignedInteger('temporary_hp')->default(0);
        });
        Schema::table('tokens', fn (Blueprint $t) => $t->unsignedInteger('temporary_hp')->default(0));
        Schema::create('spell_turn_slots', function (Blueprint $t) {
            $t->id();
            $t->foreignId('combat_id')->constrained()->cascadeOnDelete();
            $t->foreignId('character_id')->constrained()->cascadeOnDelete();
            $t->unsignedBigInteger('turn_sequence');
            $t->unique(['combat_id', 'character_id', 'turn_sequence']);
        });
        Schema::create('spell_effects', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $t->foreignId('character_id')->constrained()->cascadeOnDelete();
            $t->foreignId('source_token_id')->nullable()->constrained('tokens')->nullOnDelete();
            $t->uuid('ability_id');
            $t->string('name', 80);
            $t->boolean('concentration')->default(false);
            $t->json('targets');
            $t->json('payload');
            $t->timestamp('expires_at')->nullable();
            $t->unsignedInteger('remaining_rounds')->nullable();
            $t->unsignedBigInteger('started_sequence')->nullable();
            $t->timestamp('ended_at')->nullable();
            $t->string('end_reason')->nullable();
            $t->timestamps();
            $t->index(['character_id', 'ended_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('spell_effects');
        Schema::dropIfExists('spell_turn_slots');
        Schema::table('tokens', fn (Blueprint $t) => $t->dropColumn('temporary_hp'));
        Schema::table('characters', fn (Blueprint $t) => $t->dropColumn(['spellcasting', 'temporary_hp']));
    }
};
