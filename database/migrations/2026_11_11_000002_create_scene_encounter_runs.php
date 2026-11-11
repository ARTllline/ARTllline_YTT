<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scene_encounter_runs', function (Blueprint $table) {
            // Historical identities survive preparation deletion/Undo and actor removal.
            // Only scene/combat deletion removes the durable launch guard.
            $table->uuid('encounter_id')->primary();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->foreignId('combat_id')->constrained()->cascadeOnDelete();
            $table->json('activated_token_ids');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scene_encounter_runs');
    }
};
