<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('terrain_chunks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('map_world_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('x');
            $table->unsignedSmallInteger('y');
            $table->string('hash', 64);
            $table->unique(['map_world_id', 'x', 'y']);
        });
        Schema::create('terrain_masks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('terrain_chunk_id')->constrained()->cascadeOnDelete();
            $table->foreignId('map_material_version_id')->constrained()->restrictOnDelete();
            $table->text('mask'); // zlib-compressed alpha bytes, base64 for portable SQL storage
            $table->unique(['terrain_chunk_id', 'map_material_version_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('terrain_masks');
        Schema::dropIfExists('terrain_chunks');
    }
};
