<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('characters', function (Blueprint $t) {
            $t->json('npc_source')->nullable();
            $t->boolean('npc_loot_backpack')->default(false);
        });
        Schema::table('assets', function (Blueprint $t) {
            $t->unsignedBigInteger('campaign_id')->nullable()->change();
            $t->foreignId('library_user_id')->nullable()->constrained('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        if (DB::table('assets')->whereNull('campaign_id')->exists()) {
            throw new RuntimeException('Move library portraits before rolling back.');
        }
        Schema::table('assets', function (Blueprint $t) {
            $t->dropConstrainedForeignId('library_user_id');
            $t->unsignedBigInteger('campaign_id')->nullable(false)->change();
        });
        Schema::table('characters', fn (Blueprint $t) => $t->dropColumn(['npc_source', 'npc_loot_backpack']));
    }
};
