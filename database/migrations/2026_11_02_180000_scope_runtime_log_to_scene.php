<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('combat_events', function (Blueprint $t) {
            $t->foreignId('scene_id')->nullable()->constrained()->cascadeOnDelete();
            $t->unsignedBigInteger('combat_id')->nullable()->change();
            $t->index(['scene_id', 'id']);
        });
        DB::table('combat_events')->whereNull('scene_id')->update([
            'scene_id' => DB::raw('(select scene_id from combats where combats.id = combat_events.combat_id)'),
        ]);
    }

    public function down(): void
    {
        // Out-of-combat history cannot be represented by the old schema.
        DB::table('combat_events')->whereNull('combat_id')->delete();
        Schema::table('combat_events', function (Blueprint $t) {
            $t->dropIndex(['scene_id', 'id']);
            $t->dropConstrainedForeignId('scene_id');
            $t->unsignedBigInteger('combat_id')->nullable(false)->change();
        });
    }
};
