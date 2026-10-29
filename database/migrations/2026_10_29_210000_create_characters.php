<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('characters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->foreignId('portrait_asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->foreignId('owner_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('kind', 24)->default('player_character');
            $table->string('disposition', 16)->default('friendly');
            $table->json('check_stats')->nullable();
            $table->unsignedSmallInteger('hp')->default(10);
            $table->unsignedSmallInteger('max_hp')->default(10);
            $table->timestamps();
        });
        Schema::table('tokens', function (Blueprint $table) {
            $table->foreignId('character_id')->nullable()->constrained()->restrictOnDelete();
            $table->unique(['scene_id', 'character_id']);
        });
        Schema::table('campaign_members', function (Blueprint $table) {
            $table->foreignId('active_character_id')->nullable()->constrained('characters')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('campaign_members', fn (Blueprint $table) => $table->dropConstrainedForeignId('active_character_id'));
        Schema::table('tokens', function (Blueprint $table) {
            $table->dropUnique(['scene_id', 'character_id']);
            $table->dropConstrainedForeignId('character_id');
        });
        Schema::dropIfExists('characters');
    }
};
