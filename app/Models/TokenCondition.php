<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TokenCondition extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['token_id' => 'integer', 'source_token_id' => 'integer', 'remaining_rounds' => 'integer', 'applied_turn_sequence' => 'integer', 'metadata' => 'array'];
    }
}
