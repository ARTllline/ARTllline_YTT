<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cues', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->text('description')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });
        Schema::create('cue_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('cue_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->string('type', 40);
            $table->json('config');
            $table->unique(['cue_id', 'position']);
        });
        Schema::create('cue_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->foreignId('cue_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->string('name', 160);
            $table->unsignedBigInteger('epoch');
            $table->string('status', 16)->default('queued');
            $table->unsignedInteger('position')->default(0);
            $table->timestamp('due_at', 3)->nullable();
            $table->text('error')->nullable();
            $table->timestamps(3);
            $table->index(['status', 'due_at']);
        });
        Schema::create('cue_run_steps', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('cue_run_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('position');
            $table->string('type', 40);
            $table->json('config');
            $table->string('status', 16)->default('queued');
            $table->timestamp('completed_at', 3)->nullable();
            $table->unique(['cue_run_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cue_run_steps');
        Schema::dropIfExists('cue_runs');
        Schema::dropIfExists('cue_steps');
        Schema::dropIfExists('cues');
    }
};
