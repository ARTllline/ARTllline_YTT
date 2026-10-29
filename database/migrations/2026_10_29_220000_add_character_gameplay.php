<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('characters', function (Blueprint $table) {
            $table->json('resources')->nullable();
            $table->json('abilities')->nullable();
            $table->unsignedInteger('ac')->nullable();
            $table->unsignedInteger('speed')->nullable();
        });
        // Preserve the oldest representation's legacy vitals deterministically.
        DB::table('characters')->orderBy('id')->each(function ($character) {
            $token = DB::table('tokens')->where('character_id', $character->id)->orderBy('id')->first();
            if ($token) {
                DB::table('characters')->where('id', $character->id)->update(['ac' => $token->ac, 'speed' => $token->speed]);
            }
        });
        Schema::create('ability_executions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('campaign_id')->constrained()->cascadeOnDelete();
            $table->foreignId('character_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('mutation_id');
            $table->string('ability_key', 80);
            $table->json('context');
            $table->json('result');
            $table->timestamp('created_at');
            $table->unique(['user_id', 'mutation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ability_executions');
        Schema::table('characters', fn (Blueprint $table) => $table->dropColumn(['resources', 'abilities', 'ac', 'speed']));
    }
};
