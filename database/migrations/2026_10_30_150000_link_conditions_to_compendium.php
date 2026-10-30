<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('token_conditions', fn (Blueprint $t) => $t->foreignId('compendium_entry_id')->nullable()->constrained()->nullOnDelete());
        $source = DB::table('compendium_sources')->where('key', 'srd-2024')->value('id');
        foreach (DB::table('compendium_entries')->where('source_id', $source)->where('entity_type', 'conditions')->get() as $entry) {
            $key = json_decode($entry->normalized_data, true)['key'] ?? null;
            if ($key) {
                DB::table('token_conditions')->where('key', $key)->update(['compendium_entry_id' => $entry->id]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('token_conditions', fn (Blueprint $t) => $t->dropConstrainedForeignId('compendium_entry_id'));
    }
};
