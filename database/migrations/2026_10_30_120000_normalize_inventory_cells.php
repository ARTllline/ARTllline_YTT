<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Shrinking footprints preserves positions, instances, stacks and hotbar references.
        DB::table('item_definitions')->update(['width' => 1, 'height' => 1]);
    }

    public function down(): void
    {
        // Single-cell items remain valid in the previous schema; do not invent old sizes.
    }
};
