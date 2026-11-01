<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Asset extends Model
{
    protected $guarded = ['id'];

    protected $hidden = ['storage_path', 'delivery_key'];

    public function scopeAvailable($query, ?int $campaignId = null, ?User $user = null)
    {
        $userId = $user?->id ?? auth()->id();

        return $query->where(function ($q) use ($campaignId, $userId) {
            $q->where('library_user_id', $userId ?? 0)
                ->orWhereHas('campaign.members', fn ($m) => $m->where('user_id', $userId ?? 0)->where('role', 'gm'));
            if ($campaignId) {
                $q->orWhere('campaign_id', $campaignId);
            }
        });
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(AssetTag::class, 'asset_tag');
    }

    public function collections(): BelongsToMany
    {
        return $this->belongsToMany(AssetCollection::class, 'asset_collection');
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}
