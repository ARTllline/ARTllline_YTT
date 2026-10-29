<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tokens', function (Blueprint $table) {
            $table->string('kind', 24)->default('npc');
            $table->string('disposition', 16)->default('neutral');
        });
        // Preserve existing ownership without guessing hostility from names or portraits.
        DB::table('tokens')->whereNotNull('owner_user_id')->update(['kind' => 'player_character', 'disposition' => 'friendly']);
    }

    public function down(): void
    {
        Schema::table('tokens', fn (Blueprint $table) => $table->dropColumn(['kind', 'disposition']));
    }
};
