<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scene_regions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('shape', 16);
            $table->json('geometry');
            $table->boolean('enabled')->default(true);
            $table->timestamps();
        });
        Schema::create('scene_triggers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('name', 160);
            $table->string('event_type', 32);
            $table->foreignId('cue_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('region_id')->nullable()->constrained('scene_regions')->nullOnDelete();
            $table->foreignId('token_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('prop_id')->nullable()->constrained('scene_props')->nullOnDelete();
            $table->string('actor_filter', 16)->default('player');
            $table->foreignId('actor_token_id')->nullable()->constrained('tokens')->nullOnDelete();
            $table->boolean('enabled')->default(true);
            $table->boolean('once')->default(true);
            $table->unsignedInteger('cooldown_ms')->default(0);
            $table->unsignedInteger('minimum_round')->default(1);
            $table->unsignedInteger('fire_count')->default(0);
            $table->timestamp('last_fired_at', 3)->nullable();
            $table->timestamps();
            $table->index(['scene_id', 'event_type', 'enabled']);
        });
        Schema::table('cue_runs', function (Blueprint $table) {
            $table->unsignedBigInteger('queue_order')->default(0);
            $table->json('trigger_chain')->nullable();
            $table->uuid('correlation_id')->nullable();
            $table->index(['campaign_id', 'queue_order']);
        });
        Schema::create('trigger_fires', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trigger_id')->constrained('scene_triggers')->cascadeOnDelete();
            $table->string('source_event', 32);
            $table->string('source_key', 64);
            $table->uuid('correlation_id');
            $table->foreignUuid('cue_run_id')->nullable()->constrained('cue_runs')->nullOnDelete();
            $table->timestamp('fired_at', 3);
            $table->unique(['trigger_id', 'source_key']);
            $table->unique(['trigger_id', 'correlation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trigger_fires');
        Schema::dropIfExists('scene_triggers');
        Schema::dropIfExists('scene_regions');
        Schema::table('cue_runs', function (Blueprint $table) {
            $table->dropIndex(['campaign_id', 'queue_order']);
            $table->dropColumn(['queue_order', 'trigger_chain', 'correlation_id']);
        });
    }
};
