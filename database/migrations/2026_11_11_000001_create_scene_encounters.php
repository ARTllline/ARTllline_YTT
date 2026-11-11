<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scene_encounters', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('status', 16)->default('draft');
            $table->json('groups');
            $table->timestamps();
        });
        Schema::create('scene_encounter_members', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('encounter_id')->constrained('scene_encounters')->cascadeOnDelete();
            $table->foreignId('token_id')->constrained()->cascadeOnDelete();
            $table->string('group_id', 40);
            $table->unique(['encounter_id', 'token_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scene_encounter_members');
        Schema::dropIfExists('scene_encounters');
    }
};
