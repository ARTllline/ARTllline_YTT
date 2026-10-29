<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tokens', function (Blueprint $table) {
            $table->json('check_stats')->nullable();
        });
        Schema::table('object_checks', function (Blueprint $table) {
            $table->json('provenance')->nullable();
            $table->json('raw_dice')->nullable();
            $table->string('roll_mode', 16)->default('normal');
            $table->json('request_context')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('object_checks', fn (Blueprint $table) => $table->dropColumn(['provenance', 'raw_dice', 'roll_mode', 'request_context']));
        Schema::table('tokens', fn (Blueprint $table) => $table->dropColumn('check_stats'));
    }
};
