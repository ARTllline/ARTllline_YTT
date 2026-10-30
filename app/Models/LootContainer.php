<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LootContainer extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['is_open' => 'boolean', 'version' => 'integer'];
    }

    public function items()
    {
        return $this->hasMany(InventoryItem::class);
    }

    public function scene()
    {
        return $this->belongsTo(Scene::class);
    }

    public function object()
    {
        return $this->token_id ? Token::find($this->token_id) : SceneProp::find($this->prop_id);
    }

    public function summary(bool $gm): array
    {
        return ['id' => (string) $this->id, 'name' => $this->name, 'open' => $this->is_open, 'version' => $this->version, 'kind' => $this->kind, ...(($gm || $this->is_open) ? ['empty' => ! $this->items()->where('quantity', '>', 0)->exists()] : [])];
    }
}
