<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scenes', function (Blueprint $table) {
            $table->string('fog_base', 12)->default('clear');
            $table->decimal('distance_per_cell', 8, 3)->default(5);
            $table->string('distance_unit', 12)->default('ft');
        });
        Schema::create('fog_actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('sequence');
            $table->string('operation', 12);
            $table->string('shape', 16);
            $table->json('geometry');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['scene_id', 'sequence']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fog_actions');
        Schema::table('scenes', fn (Blueprint $table) => $table->dropColumn(['fog_base', 'distance_per_cell', 'distance_unit']));
    }
};
