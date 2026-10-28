<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('combats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('status', 16)->default('preparing');
            $table->unsignedInteger('round')->default(0);
            $table->unsignedBigInteger('current_combatant_id')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
            $table->index(['scene_id', 'status']);
        });
        Schema::create('combatants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('combat_id')->constrained()->cascadeOnDelete();
            $table->foreignId('token_id')->constrained()->cascadeOnDelete();
            $table->decimal('initiative', 8, 2)->nullable();
            $table->unsignedInteger('position');
            $table->timestamps();
            $table->unique(['combat_id', 'token_id']);
        });
        Schema::table('combats', function (Blueprint $table) {
            $table->foreign('current_combatant_id')->references('id')->on('combatants')->nullOnDelete();
        });
        Schema::create('token_conditions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('token_id')->constrained()->cascadeOnDelete();
            $table->string('key', 32)->nullable();
            $table->string('label', 40);
            $table->string('normalized_label', 40);
            $table->string('visibility', 16)->default('public');
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
            $table->unique(['token_id', 'normalized_label']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('token_conditions');
        Schema::table('combats', fn (Blueprint $table) => $table->dropForeign(['current_combatant_id']));
        Schema::dropIfExists('combatants');
        Schema::dropIfExists('combats');
    }
};
