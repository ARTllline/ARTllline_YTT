<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('object_checks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('object_kind', 8);
            $table->unsignedBigInteger('object_id');
            $table->uuid('action_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('token_id')->nullable();
            $table->uuid('mutation_id');
            $table->string('action_label', 48);
            $table->string('label', 80);
            $table->string('ability_key', 48)->nullable();
            $table->unsignedTinyInteger('natural');
            $table->smallInteger('modifier');
            $table->smallInteger('total');
            $table->unsignedTinyInteger('dc');
            $table->boolean('dc_visible')->default(false);
            $table->boolean('success');
            $table->json('branch');
            $table->timestamp('created_at');
            $table->unique(['user_id', 'mutation_id']);
            $table->index(['scene_id', 'object_kind', 'object_id', 'action_id'], 'object_checks_action');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('object_checks');
    }
};
