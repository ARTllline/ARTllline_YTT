<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaigns', fn (Blueprint $table) => $table->unsignedBigInteger('live_revision')->default(0));
        Schema::create('campaign_invites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('created_by_user_id')->constrained('users')->restrictOnDelete();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->unsignedInteger('max_uses')->nullable();
            $table->unsignedInteger('uses_count')->default(0);
            $table->timestamps();
        });
        Schema::create('scene_mutation_receipts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('client_mutation_id');
            $table->char('fingerprint', 64);
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->string('operation', 40);
            $table->unsignedBigInteger('resource_id');
            $table->unsignedBigInteger('result_revision')->nullable();
            $table->json('result')->nullable();
            $table->unsignedSmallInteger('status')->nullable();
            $table->timestamps();
            $table->unique(['user_id', 'client_mutation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scene_mutation_receipts');
        Schema::dropIfExists('campaign_invites');
        Schema::table('campaigns', fn (Blueprint $table) => $table->dropColumn('live_revision'));
    }
};
