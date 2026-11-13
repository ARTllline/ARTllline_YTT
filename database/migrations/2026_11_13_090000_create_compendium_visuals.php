<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('compendium_visuals', function (Blueprint $table) {
            $table->foreignId('compendium_entry_id')->primary()->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->restrictOnDelete();
            $table->string('pack', 80);
            $table->string('source_record_id', 200);
            $table->char('entry_checksum', 64);
            $table->char('image_sha256', 64);
            $table->json('evidence');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('compendium_visuals');
    }
};
