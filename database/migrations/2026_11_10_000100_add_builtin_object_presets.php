<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('object_presets', function (Blueprint $table) {
            $table->unsignedBigInteger('library_user_id')->nullable()->change();
            $table->string('builtin_key', 120)->nullable()->unique();
        });
    }

    public function down(): void
    {
        if (DB::table('object_presets')->whereNotNull('builtin_key')->exists()) {
            throw new LogicException('Installed object presets may be referenced by scene props.');
        }
        Schema::table('object_presets', function (Blueprint $table) {
            $table->dropUnique(['builtin_key']);
            $table->dropColumn('builtin_key');
            $table->unsignedBigInteger('library_user_id')->nullable(false)->change();
        });
    }
};
