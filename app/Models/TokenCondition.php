<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TokenCondition extends Model
{
    public const PRESETS = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious', 'concentrating'];

    protected $guarded = ['id'];
}
