<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['characters', 'tokens'] as $name) {
            Schema::table($name, function (Blueprint $t) {
                $t->json('lifecycle')->nullable();
                $t->unsignedTinyInteger('exhaustion')->default(0);
            });
        }
        Schema::table('characters', function (Blueprint $t) {
            $t->json('hit_point_dice')->nullable();
            $t->json('rest_state')->nullable();
            $t->json('recovery_baseline')->nullable();
        });
        Schema::create('lifecycle_commands', function (Blueprint $t) {
            $t->id();
            $t->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $t->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->uuid('mutation_id');
            $t->string('fingerprint', 64);
            $t->json('result');
            $t->timestamp('created_at');
            $t->unique(['user_id', 'mutation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('lifecycle_commands');
        Schema::table('characters', fn (Blueprint $t) => $t->dropColumn(['hit_point_dice', 'rest_state', 'recovery_baseline']));
        foreach (['characters', 'tokens'] as $name) {
            Schema::table($name, fn (Blueprint $t) => $t->dropColumn(['lifecycle', 'exhaustion']));
        }
    }
};
