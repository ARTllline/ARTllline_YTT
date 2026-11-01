<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_items', fn (Blueprint $t) => $t->unsignedSmallInteger('charges')->nullable());
    }

    public function down(): void
    {
        Schema::table('inventory_items', fn (Blueprint $t) => $t->dropColumn('charges'));
    }
};
