<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('object_presets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('library_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->restrictOnDelete();
            $table->string('name', 160);
            $table->string('category', 80);
            $table->json('settings');
            $table->timestamps();
        });
        Schema::table('scene_props', fn (Blueprint $table) => $table->json('preset_snapshot')->nullable());
    }

    public function down(): void
    {
        Schema::table('scene_props', fn (Blueprint $table) => $table->dropColumn('preset_snapshot'));
        Schema::dropIfExists('object_presets');
    }
};
