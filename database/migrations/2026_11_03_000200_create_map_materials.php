<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('map_materials', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();
        });
        Schema::create('map_material_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('map_material_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('version');
            $table->foreignId('asset_id')->constrained()->restrictOnDelete();
            $table->string('name', 120);
            $table->string('type', 16);
            $table->float('repeat_size');
            $table->float('rotation')->default(0);
            $table->json('variation');
            $table->timestamp('created_at');
            $table->unique(['map_material_id', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('map_material_versions');
        Schema::dropIfExists('map_materials');
    }
};
