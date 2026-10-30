<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Combat extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['round' => 'integer', 'turn_sequence' => 'integer', 'current_combatant_id' => 'integer', 'started_at' => 'datetime', 'ended_at' => 'datetime'];
    }

    public function combatants(): HasMany
    {
        return $this->hasMany(Combatant::class)->orderBy('position')->orderBy('id');
    }
}
