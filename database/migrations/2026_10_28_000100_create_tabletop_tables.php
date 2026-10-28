<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->timestamps();
        });
        Schema::create('campaign_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->enum('role', ['gm', 'player']);
            $table->unique(['campaign_id', 'user_id']);
            $table->index(['user_id', 'role']);
            $table->timestamps();
        });
        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uploaded_by')->constrained('users')->restrictOnDelete();
            $table->enum('kind', ['map', 'token']);
            $table->string('original_name', 255);
            $table->string('storage_path')->unique();
            $table->string('mime_type', 40);
            $table->unsignedBigInteger('file_size');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->timestamps();
        });
        Schema::create('scenes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedBigInteger('revision')->default(0);
            $table->unsignedInteger('width')->default(1440);
            $table->unsignedInteger('height')->default(1080);
            $table->string('grid_type', 12)->default('square');
            $table->decimal('grid_size', 10, 3)->default(60);
            $table->decimal('grid_offset_x', 12, 3)->default(0);
            $table->decimal('grid_offset_y', 12, 3)->default(0);
            $table->boolean('grid_visible')->default(true);
            $table->boolean('grid_snap')->default(true);
            $table->foreignId('map_asset_id')->nullable()->constrained('assets')->restrictOnDelete();
            $table->decimal('map_x', 12, 3)->default(0);
            $table->decimal('map_y', 12, 3)->default(0);
            $table->decimal('map_width', 12, 3)->default(1440);
            $table->decimal('map_height', 12, 3)->default(1080);
            $table->index(['campaign_id', 'sort_order']);
            $table->timestamps();
        });
        Schema::table('campaigns', function (Blueprint $table) {
            $table->foreignId('active_scene_id')->nullable()->constrained('scenes')->nullOnDelete();
        });
        Schema::create('tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->decimal('x', 12, 3);
            $table->decimal('y', 12, 3);
            $table->decimal('rotation', 7, 3)->default(0);
            $table->decimal('scale', 5, 3)->default(1);
            $table->decimal('size', 8, 3)->default(52);
            $table->unsignedInteger('hp')->default(10);
            $table->unsignedInteger('max_hp')->default(10);
            $table->unsignedInteger('ac')->nullable();
            $table->unsignedInteger('speed')->nullable();
            $table->boolean('is_hidden')->default(false);
            $table->boolean('is_locked')->default(false);
            $table->foreignId('owner_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('token_image_asset_id')->nullable()->constrained('assets')->restrictOnDelete();
            $table->integer('z_index')->default(0);
            $table->index(['scene_id', 'is_hidden']);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tokens');
        Schema::table('campaigns', fn (Blueprint $table) => $table->dropConstrainedForeignId('active_scene_id'));
        Schema::dropIfExists('scenes');
        Schema::dropIfExists('assets');
        Schema::dropIfExists('campaign_members');
        Schema::dropIfExists('campaigns');
    }
};
