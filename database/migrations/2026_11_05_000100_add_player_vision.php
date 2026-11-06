<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scenes', fn (Blueprint $table) => $table->boolean('vision_enabled')->default(false));
        Schema::table('tokens', fn (Blueprint $table) => $table->float('vision_range')->default(600));
    }

    public function down(): void
    {
        Schema::table('tokens', fn (Blueprint $table) => $table->dropColumn('vision_range'));
        Schema::table('scenes', fn (Blueprint $table) => $table->dropColumn('vision_enabled'));
    }
};
