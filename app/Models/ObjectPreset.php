<?php

namespace App\Models;

use App\Services\SceneSnapshotBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ObjectPreset extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['settings' => 'array'];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function scopeAvailable($query, User $user)
    {
        return $query->where(fn ($q) => $q->where('library_user_id', $user->id)->orWhereNotNull('builtin_key'));
    }

    public function projection(): array
    {
        return ['id' => (string) $this->id, 'name' => $this->name, 'category' => $this->category,
            'asset' => app(SceneSnapshotBuilder::class)->asset($this->asset), 'settings' => $this->settings,
            'builtin' => $this->builtin_key !== null, 'thumbnailUrl' => '/api/assets/'.$this->asset_id.'/thumbnail'];
    }
}
