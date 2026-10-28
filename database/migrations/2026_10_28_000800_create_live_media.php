<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assets', fn (Blueprint $table) => $table->unsignedInteger('duration_ms')->nullable());
        Schema::create('live_media', function (Blueprint $table) {
            $table->foreignId('campaign_id')->primary()->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('revision')->default(0);
            $table->json('state');
        });
        // Expiring delivery authorization, never an event log or reconnect playlist.
        Schema::create('audio_grants', function (Blueprint $table) {
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained()->cascadeOnDelete();
            $table->timestamp('expires_at', 3)->index();
            $table->primary(['campaign_id', 'asset_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audio_grants');
        Schema::dropIfExists('live_media');
        Schema::table('assets', fn (Blueprint $table) => $table->dropColumn('duration_ms'));
    }
};
