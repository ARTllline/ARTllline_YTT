<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('scene_props', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->restrictOnDelete();
            $table->string('name', 160)->nullable();
            $table->decimal('x', 12, 3);
            $table->decimal('y', 12, 3);
            $table->decimal('rotation', 8, 3)->default(0);
            $table->decimal('scale_x', 10, 4)->default(1);
            $table->decimal('scale_y', 10, 4)->default(1);
            $table->integer('z_index')->default(0);
            $table->boolean('is_locked')->default(false);
            $table->boolean('is_hidden')->default(false);
            $table->timestamps();
            $table->index(['scene_id', 'is_hidden', 'z_index']);
        });
        Schema::create('content_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 16);
            $table->string('name', 160);
            $table->timestamps();
            $table->index(['campaign_id', 'kind', 'id']);
        });
        Schema::create('content_template_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('content_template_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('kind', 16);
            $table->json('data');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('content_template_items');
        Schema::dropIfExists('content_templates');
        Schema::dropIfExists('scene_props');
    }
};
