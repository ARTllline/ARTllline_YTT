<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('library_items', function (Blueprint $t) {
            $t->uuid('id')->primary();
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->json('definition');
            $t->timestamps();
        });
        Schema::table('item_definitions', fn (Blueprint $t) => $t->unsignedBigInteger('campaign_id')->nullable()->change());
    }

    public function down(): void
    {
        if (DB::table('item_definitions')->whereNull('campaign_id')->exists()) {
            throw new RuntimeException('Independent item instances must be preserved.');
        }
        Schema::table('item_definitions', fn (Blueprint $t) => $t->unsignedBigInteger('campaign_id')->nullable(false)->change());
        Schema::dropIfExists('library_items');
    }
};
