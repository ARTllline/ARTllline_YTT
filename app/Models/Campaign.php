<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Campaign extends Model
{
    protected $fillable = ['name'];

    protected function casts(): array
    {
        return ['live_revision' => 'integer'];
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'campaign_members')->withPivot('role')->withTimestamps();
    }

    public function scenes(): HasMany
    {
        return $this->hasMany(Scene::class);
    }

    public function roleFor(User $user): ?string
    {
        return $this->members()->where('users.id', $user->id)->first()?->pivot->role;
    }
}
