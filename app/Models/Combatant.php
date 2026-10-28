<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Combatant extends Model
{
    protected $guarded = ['id'];

    public function token(): BelongsTo
    {
        return $this->belongsTo(Token::class);
    }
}
