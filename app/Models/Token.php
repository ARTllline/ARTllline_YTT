<?php

namespace App\Models;

use App\Spells\SpellEffects;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Token extends Model
{
    /** Persistent fields are read from Character; legacy columns remain for standalone tokens. */
    public const CHARACTER_FIELDS = ['temporary_hp' => 'temporary_hp', 'combat_profile' => 'combat_profile', 'abilities' => 'abilities', 'resources' => 'resources', 'name' => 'name', 'token_image_asset_id' => 'portrait_asset_id',
        'owner_user_id' => 'owner_user_id', 'kind' => 'kind', 'disposition' => 'disposition',
        'ac' => 'ac', 'speed' => 'speed', 'check_stats' => 'check_stats', 'hp' => 'hp', 'max_hp' => 'max_hp'];

    protected $guarded = ['id', 'scene_id'];

    public function character(): BelongsTo
    {
        return $this->belongsTo(Character::class);
    }

    public function getAttribute($key)
    {
        if (isset(self::CHARACTER_FIELDS[$key]) && ! empty($this->attributes['character_id'])) {
            return $this->character->getAttribute(self::CHARACTER_FIELDS[$key]);
        }

        $value = parent::getAttribute($key);
        if ($this->exists && in_array($key, ['ac', 'speed']) && $value !== null) {
            return max(0, $value + array_sum(array_column(app(SpellEffects::class)->flat($this, $key), 'value')));
        }

        return $value;
    }

    protected function casts(): array
    {
        return ['temporary_hp' => 'integer', 'combat_profile' => 'array', 'abilities' => 'array', 'resources' => 'array', 'is_hidden' => 'boolean', 'is_locked' => 'boolean', 'interactions' => 'array', 'check_stats' => 'array'];
    }

    public function scene(): BelongsTo
    {
        return $this->belongsTo(Scene::class);
    }

    public function conditions(): HasMany
    {
        return $this->hasMany(TokenCondition::class)->orderBy('id');
    }

    public function imageAsset(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'token_image_asset_id');
    }
}
