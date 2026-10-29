<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        foreach (['tokens', 'scene_props'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->json('interactions')->nullable());
        }
    }

    public function down(): void
    {
        foreach (['tokens', 'scene_props'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn('interactions'));
        }
    }
};
