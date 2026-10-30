<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('combats', 'turn_sequence')) {
            Schema::table('combats', fn (Blueprint $t) => $t->unsignedInteger('turn_sequence')->default(0));
        }
        if (! Schema::hasColumn('combatants', 'action_available')) {
            Schema::table('combatants', function (Blueprint $t) {
                $t->boolean('action_available')->default(true);
                $t->boolean('bonus_available')->default(true);
                $t->boolean('reaction_available')->default(true);
                $t->decimal('movement_spent', 12, 4)->default(0);
            });
        }
        foreach (['characters', 'tokens'] as $table) {
            if (! Schema::hasColumn($table, 'combat_profile')) {
                Schema::table($table, fn (Blueprint $t) => $t->json('combat_profile')->nullable());
            }
        }
        if (! Schema::hasColumn('tokens', 'abilities')) {
            Schema::table('tokens', function (Blueprint $t) {
                $t->json('abilities')->nullable();
                $t->json('resources')->nullable();
            });
        }
        if (! Schema::hasColumn('ability_executions', 'token_id')) {
            Schema::table('ability_executions', function (Blueprint $t) {
                $t->unsignedBigInteger('character_id')->nullable()->change();
                $t->foreignId('token_id')->nullable()->constrained()->nullOnDelete();
            });
        }
        if (! Schema::hasIndex('token_conditions', 'token_conditions_token_id_normalized_label_index')) {
            Schema::table('token_conditions', fn (Blueprint $t) => $t->index(['token_id', 'normalized_label']));
        }
        if (Schema::hasIndex('token_conditions', 'token_conditions_token_id_normalized_label_unique')) {
            Schema::table('token_conditions', fn (Blueprint $t) => $t->dropUnique(['token_id', 'normalized_label']));
        }
        if (! Schema::hasColumn('token_conditions', 'combat_id')) {
            Schema::table('token_conditions', function (Blueprint $t) {
                $t->foreignId('combat_id')->nullable()->constrained()->cascadeOnDelete();
                $t->foreignId('source_token_id')->nullable()->constrained('tokens')->nullOnDelete();
                $t->uuid('source_ability_id')->nullable();
                $t->string('duration_mode', 40)->default('until_removed');
                $t->unsignedSmallInteger('remaining_rounds')->nullable();
                $t->unsignedInteger('applied_turn_sequence')->nullable();
                $t->json('metadata')->nullable();
            });
        }
        if (! Schema::hasTable('combat_events')) {
            Schema::create('combat_events', function (Blueprint $t) {
                $t->id();
                $t->foreignId('combat_id')->constrained()->cascadeOnDelete();
                $t->unsignedInteger('turn_sequence');
                $t->string('type', 40);
                $t->json('data');
                $t->uuid('mutation_id');
                $t->timestamp('created_at');
                $t->index(['combat_id', 'id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('combat_events');
        Schema::table('token_conditions', function (Blueprint $t) {
            $t->dropConstrainedForeignId('combat_id');
            $t->dropConstrainedForeignId('source_token_id');
            $t->dropColumn(['source_ability_id', 'duration_mode', 'remaining_rounds', 'applied_turn_sequence', 'metadata']);
        });
        Schema::table('ability_executions', fn (Blueprint $t) => $t->dropConstrainedForeignId('token_id'));
        foreach (['characters', 'tokens'] as $table) {
            Schema::table($table, fn (Blueprint $t) => $t->dropColumn('combat_profile'));
        }
        Schema::table('tokens', fn (Blueprint $t) => $t->dropColumn(['abilities', 'resources']));
        Schema::table('combatants', fn (Blueprint $t) => $t->dropColumn(['action_available', 'bonus_available', 'reaction_available', 'movement_spent']));
        Schema::table('combats', fn (Blueprint $t) => $t->dropColumn('turn_sequence'));
    }
};
