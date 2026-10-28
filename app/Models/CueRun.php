<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CueRun extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected $attributes = ['position' => 0, 'status' => 'queued'];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected $casts = ['due_at' => 'immutable_datetime', 'position' => 'integer', 'epoch' => 'integer'];

    public function steps(): HasMany
    {
        return $this->hasMany(CueRunStep::class)->orderBy('position');
    }
}
