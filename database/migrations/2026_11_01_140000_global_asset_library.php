<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assets', function (Blueprint $t) {
            $t->dropForeign(['campaign_id']);
            $t->foreign('campaign_id')->references('id')->on('campaigns')->nullOnDelete();
            $t->string('category', 24)->nullable()->index();
        });
        DB::table('assets')->whereNull('library_user_id')->update(['library_user_id' => DB::raw('uploaded_by')]);
        foreach (['asset_tags', 'asset_collections'] as $name) {
            Schema::table($name, function (Blueprint $t) {
                $t->unsignedBigInteger('campaign_id')->nullable()->change();
                $t->foreignId('library_user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $t->unique(['library_user_id', 'name']);
            });
        }
    }

    public function down(): void
    {
        foreach (['asset_tags', 'asset_collections'] as $name) {
            if (DB::table($name)->whereNull('campaign_id')->exists()) {
                throw new RuntimeException('Assign global labels to a campaign before rolling back.');
            }
            Schema::table($name, function (Blueprint $t) {
                $t->dropUnique(['library_user_id', 'name']);
                $t->dropConstrainedForeignId('library_user_id');
                $t->unsignedBigInteger('campaign_id')->nullable(false)->change();
            });
        }
        Schema::table('assets', function (Blueprint $t) {
            $t->dropIndex(['category']);
            $t->dropColumn('category');
            $t->dropForeign(['campaign_id']);
            $t->foreign('campaign_id')->references('id')->on('campaigns')->cascadeOnDelete();
        });
    }
};
