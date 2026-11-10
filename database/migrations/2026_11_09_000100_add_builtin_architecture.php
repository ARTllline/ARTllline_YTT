<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assets', function (Blueprint $table) {
            $table->unsignedBigInteger('uploaded_by')->nullable()->change();
            $table->string('builtin_key', 120)->nullable()->unique();
        });
        Schema::table('map_materials', function (Blueprint $table) {
            $table->unsignedBigInteger('user_id')->nullable()->change();
            $table->string('builtin_key', 120)->nullable()->unique();
        });
        Schema::table('map_material_versions', function (Blueprint $table) {
            $table->string('layout', 16)->nullable();
        });
    }

    public function down(): void
    {
        if (\Illuminate\Support\Facades\DB::table('map_materials')->whereNotNull('builtin_key')->exists()
            || \Illuminate\Support\Facades\DB::table('assets')->whereNotNull('builtin_key')->exists()) {
            throw new \LogicException('Installed architecture may be referenced by scenes and personal material versions.');
        }
        Schema::table('map_material_versions', fn (Blueprint $table) => $table->dropColumn('layout'));
        Schema::table('map_materials', function (Blueprint $table) {
            $table->dropUnique(['builtin_key']);
            $table->dropColumn('builtin_key');
            $table->unsignedBigInteger('user_id')->nullable(false)->change();
        });
        Schema::table('assets', function (Blueprint $table) {
            $table->dropUnique(['builtin_key']);
            $table->dropColumn('builtin_key');
            $table->unsignedBigInteger('uploaded_by')->nullable(false)->change();
        });
    }
};
