<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('characters', function (Blueprint $table) {
            $table->dropForeign(['campaign_id']);
        });
        Schema::table('characters', function (Blueprint $table) {
            $table->unsignedBigInteger('campaign_id')->nullable()->change();
            $table->foreign('campaign_id')->references('id')->on('campaigns')->nullOnDelete();
            $table->foreignId('library_user_id')->nullable()->constrained('users')->nullOnDelete();
        });
        // Preserve existing IDs, tokens and player assignments. No synthetic campaign.
        foreach (DB::table('campaign_members')->where('role', 'gm')->orderBy('user_id')->get() as $member) {
            DB::table('characters')->where('campaign_id', $member->campaign_id)->where('kind', 'player_character')->whereNull('library_user_id')->update(['library_user_id' => $member->user_id]);
        }
        Schema::table('scene_mutation_receipts', function (Blueprint $table) {
            $table->unsignedBigInteger('campaign_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        // A rollback must never delete independent characters to satisfy NOT NULL.
        if (DB::table('characters')->whereNull('campaign_id')->exists() || DB::table('scene_mutation_receipts')->whereNull('campaign_id')->exists()) {
            throw new RuntimeException('Assign independent characters and retire global mutation receipts before rolling back this migration.');
        }
        Schema::table('scene_mutation_receipts', fn (Blueprint $table) => $table->unsignedBigInteger('campaign_id')->nullable(false)->change());
        Schema::table('characters', function (Blueprint $table) {
            $table->dropForeign(['campaign_id']);
            $table->dropConstrainedForeignId('library_user_id');
        });
        Schema::table('characters', function (Blueprint $table) {
            $table->unsignedBigInteger('campaign_id')->nullable(false)->change();
            $table->foreign('campaign_id')->references('id')->on('campaigns')->cascadeOnDelete();
        });
    }
};
