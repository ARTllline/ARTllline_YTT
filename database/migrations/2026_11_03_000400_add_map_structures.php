<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_worlds', function (Blueprint $table) {
            $table->json('structure')->nullable();
        });
        Schema::create('map_structure_materials', function (Blueprint $table) {
            $table->foreignId('map_world_id')->constrained()->cascadeOnDelete();
            $table->foreignId('map_material_version_id')->constrained()->restrictOnDelete();
            $table->primary(['map_world_id', 'map_material_version_id'], 'structure_material_primary');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('map_structure_materials');
        Schema::table('map_worlds', fn (Blueprint $table) => $table->dropColumn('structure'));
    }
};
