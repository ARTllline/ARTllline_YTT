<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('map_worlds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->unique()->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('schema_version')->default(1);
            // Normalized source-image rectangle. Scene owns bounds, grid and image placement.
            $table->json('reference_crop')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('map_worlds');
    }
};
