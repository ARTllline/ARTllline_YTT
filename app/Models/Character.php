<?php

namespace App\Models;

use App\Services\CharacterRules;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Character extends Model
{
    public function inventory(): HasMany
    {
        return $this->hasMany(InventoryItem::class);
    }

    public function getAttribute($key)
    {
        $value = parent::getAttribute($key);

        return match ($key) {
            'ac', 'speed' => app(CharacterRules::class)->core($this, $key, $value),
            'check_stats' => app(CharacterRules::class)->checks($this),
            default => $value,
        };
    }

    protected $guarded = ['id', 'campaign_id'];

    protected function casts(): array
    {
        return ['recovery_baseline' => 'array', 'lifecycle' => 'array', 'exhaustion' => 'integer', 'hit_point_dice' => 'array', 'rest_state' => 'array', 'spellcasting' => 'array', 'temporary_hp' => 'integer', 'combat_profile' => 'array', 'rules' => 'array', 'check_stats' => 'array', 'resources' => 'array', 'abilities' => 'array', 'ac' => 'integer', 'speed' => 'integer', 'hp' => 'integer', 'max_hp' => 'integer', 'owner_user_id' => 'integer'];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    public function portraitAsset(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'portrait_asset_id');
    }

    public function tokens(): HasMany
    {
        return $this->hasMany(Token::class);
    }
}
