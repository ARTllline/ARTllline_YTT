<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('game_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('status', 16)->default('planned');
            $table->unsignedInteger('plan_revision')->default(0);
            $table->mediumText('notes')->nullable();
            $table->boolean('auto_preload')->default(false);
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamps();
        });
        Schema::create('session_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('game_session_id')->constrained()->cascadeOnDelete();
            $table->string('type', 16);
            $table->unsignedInteger('position');
            $table->string('title', 160)->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('scene_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('cue_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('handout_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('content_template_id')->nullable()->constrained()->nullOnDelete();
            $table->index(['game_session_id', 'position']);
        });
        Schema::table('game_sessions', fn (Blueprint $table) => $table->foreignUuid('current_item_id')->nullable()->constrained('session_items')->nullOnDelete());
        Schema::table('assets', fn (Blueprint $table) => $table->uuid('delivery_key')->nullable()->unique());
        Schema::create('scene_preloads', function (Blueprint $table) {
            $table->foreignId('campaign_id')->primary()->constrained()->cascadeOnDelete();
            $table->uuid('id')->unique();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('scene_revision');
            $table->boolean('include_audio')->default(false);
            $table->json('resources');
            $table->timestamp('expires_at');
        });
        Schema::create('preload_readiness', function (Blueprint $table) {
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('batch_id');
            $table->uuid('client_id');
            $table->string('status', 16);
            $table->unsignedInteger('loaded')->default(0);
            $table->timestamp('updated_at');
            $table->primary(['campaign_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('preload_readiness');
        Schema::dropIfExists('scene_preloads');
        Schema::table('assets', function (Blueprint $table) {
            $table->dropUnique(['delivery_key']);
            $table->dropColumn('delivery_key');
        });
        Schema::table('game_sessions', fn (Blueprint $table) => $table->dropConstrainedForeignId('current_item_id'));
        Schema::dropIfExists('session_items');
        Schema::dropIfExists('game_sessions');
    }
};
