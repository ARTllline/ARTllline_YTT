<?php

namespace App\Models;

use App\Services\SceneSnapshotBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Campaign preparation definition; spawned objects have no live link back here. */
class ContentTemplate extends Model
{
    protected $guarded = ['id'];

    public function items(): HasMany
    {
        return $this->hasMany(ContentTemplateItem::class)->orderBy('id');
    }

    public function projection(): array
    {
        return ['id' => (string) $this->id, 'name' => $this->name, 'kind' => $this->kind,
            'count' => $this->items_count ?? $this->items->count(),
            'items' => $this->items->map(fn ($item) => ['kind' => $item->kind, 'data' => $item->data,
                'image' => app(SceneSnapshotBuilder::class)->asset($item->asset),
                'thumbnailUrl' => $item->asset_id ? '/api/assets/'.$item->asset_id.'/thumbnail' : null])->all()];
    }
}
