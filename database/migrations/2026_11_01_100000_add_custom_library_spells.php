<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('compendium_entries', fn (Blueprint $t) => $t->foreignId('library_user_id')->nullable()->constrained('users')->cascadeOnDelete());
        DB::table('compendium_sources')->insert([
            'key' => 'custom-library', 'name' => 'Custom', 'version' => '1', 'license' => 'Custom',
            'source_url' => '', 'metadata' => '{}', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('compendium_entries')->whereNotNull('library_user_id')->delete();
        Schema::table('compendium_entries', fn (Blueprint $t) => $t->dropConstrainedForeignId('library_user_id'));
        DB::table('compendium_sources')->where('key', 'custom-library')->delete();
    }
};
