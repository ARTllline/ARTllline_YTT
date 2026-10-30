<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Combatant extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['token_id' => 'integer', 'action_available' => 'boolean', 'bonus_available' => 'boolean', 'reaction_available' => 'boolean', 'movement_spent' => 'float'];
    }

    public function token(): BelongsTo
    {
        return $this->belongsTo(Token::class);
    }
}
