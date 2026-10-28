<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class GameSession extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['auto_preload' => 'boolean', 'started_at' => 'datetime', 'ended_at' => 'datetime', 'plan_revision' => 'integer'];
    }

    public function items(): HasMany
    {
        return $this->hasMany(SessionItem::class)->orderBy('position');
    }
}
