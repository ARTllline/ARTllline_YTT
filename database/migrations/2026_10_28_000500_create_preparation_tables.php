<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assets', function (Blueprint $table) {
            $table->string('kind', 32)->change();
            $table->string('name')->default('Untitled asset');
            $table->index(['campaign_id', 'kind', 'id']);
        });
        DB::table('assets')->orderBy('id')->chunkById(200, function ($assets) {
            foreach ($assets as $asset) {
                DB::table('assets')->where('id', $asset->id)->update(['name' => mb_substr(trim(preg_replace('/[_-]+/u', ' ', pathinfo($asset->original_name, PATHINFO_FILENAME))) ?: 'Untitled asset', 0, 255)]);
            }
        });
        foreach (['asset_tags', 'asset_collections'] as $name) {
            Schema::create($name, function (Blueprint $table) {
                $table->id();
                $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
                $table->string('name', 80);
                $table->unsignedInteger('sort_order')->default(0);
                $table->timestamps();
                $table->unique(['campaign_id', 'name']);
            });
        }
        foreach (['tag', 'collection'] as $kind) {
            Schema::create('asset_'.$kind, function (Blueprint $table) use ($kind) {
                $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
                $table->foreignId('asset_'.$kind.'_id')->constrained()->cascadeOnDelete();
                $table->primary(['asset_id', 'asset_'.$kind.'_id']);
            });
        }
        Schema::create('handouts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->restrictOnDelete();
            $table->string('title', 160);
            $table->text('description')->nullable();
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
            $table->unique(['campaign_id', 'asset_id']);
        });
        Schema::create('handout_reveals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('handout_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamp('revealed_at');
            $table->unique(['handout_id', 'user_id']);
        });
        Schema::create('scene_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->decimal('x', 12, 3);
            $table->decimal('y', 12, 3);
            $table->string('title', 160);
            $table->text('body');
            $table->string('icon', 20)->default('note');
            $table->foreignId('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        foreach (['scene_notes', 'handout_reveals', 'handouts', 'asset_collection', 'asset_tag', 'asset_collections', 'asset_tags'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('assets', function (Blueprint $table) {
            $table->dropIndex(['campaign_id', 'kind', 'id']);
            $table->dropColumn('name');
        });
    }
};
