<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scenes', fn (Blueprint $table) => $table->string('fog_memory_policy', 16)->default('player'));
        Schema::create('fog_memories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('scope', 64);
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->unsignedInteger('cell_size');
            $table->text('bits');
            $table->unique(['scene_id', 'scope']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fog_memories');
        Schema::table('scenes', fn (Blueprint $table) => $table->dropColumn('fog_memory_policy'));
    }
};
