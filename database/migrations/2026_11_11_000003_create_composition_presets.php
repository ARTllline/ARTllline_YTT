<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('composition_presets', function (Blueprint $t) {
            $t->id();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->string('name', 160);
            $t->text('description')->nullable();
            $t->unsignedInteger('revision')->default(1);
            $t->json('snapshot');
            $t->timestamps();
            $t->index(['user_id', 'name']);
        });
        Schema::create('composition_preset_assets', function (Blueprint $t) {
            $t->foreignId('composition_preset_id')->constrained()->cascadeOnDelete();
            $t->foreignId('asset_id')->constrained()->restrictOnDelete();
            $t->primary(['composition_preset_id', 'asset_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('composition_preset_assets');
        Schema::dropIfExists('composition_presets');
    }
};
