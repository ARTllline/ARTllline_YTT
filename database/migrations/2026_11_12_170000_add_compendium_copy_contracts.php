<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('compendium_copies', function (Blueprint $table) {
            $table->foreignId('campaign_id')->nullable()->change();
            $table->foreignId('owner_user_id')->nullable()->constrained('users')->restrictOnDelete();
        });
        Schema::table('item_definitions', fn (Blueprint $table) => $table->json('content')->nullable());
    }

    public function down(): void
    {
        // Never drop immutable provenance, even for campaign-owned copies.
        if (DB::table('compendium_copies')->whereNull('campaign_id')->orWhereNotNull('owner_user_id')->exists()
            || DB::table('item_definitions')->whereNotNull('content')->exists()) {
            throw new RuntimeException('Versioned copies exist; preserve their receipts and provenance before reverting this schema.');
        }
        Schema::table('item_definitions', fn (Blueprint $table) => $table->dropColumn('content'));
        Schema::table('compendium_copies', function (Blueprint $table) {
            $table->dropConstrainedForeignId('owner_user_id');
            $table->foreignId('campaign_id')->nullable(false)->change();
        });
    }
};
