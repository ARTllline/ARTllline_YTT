<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('trigger_fires', function (Blueprint $table) {
            // source_key remains unique per trigger/crossing. Correlation still
            // bounds Cue recursion, but a root route can cross a region repeatedly.
            $table->dropUnique(['trigger_id', 'correlation_id']);
            $table->index(['trigger_id', 'correlation_id']);
        });
    }

    public function down(): void
    {
        if (DB::table('trigger_fires')->select('trigger_id', 'correlation_id')->groupBy('trigger_id', 'correlation_id')->havingRaw('COUNT(*) > 1')->exists()) {
            throw new RuntimeException('Cannot restore correlation uniqueness while distinct path crossings exist. Retain the migration when rolling back application code; no fire history has been deleted.');
        }
        Schema::table('trigger_fires', function (Blueprint $table) {
            $table->dropIndex(['trigger_id', 'correlation_id']);
            $table->unique(['trigger_id', 'correlation_id']);
        });
    }
};
