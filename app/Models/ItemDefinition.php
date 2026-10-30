<?php

namespace App\Models;

use App\Services\CharacterGameplay;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class ItemDefinition extends Model
{
    use HasUuids;

    protected $guarded = ['id', 'campaign_id'];

    public function projection(bool $gm = false): array
    {
        $data = $this->toArray();
        if (! $gm && isset($data['gameplay']['use']['ability'])) {
            $draft = new Character;
            $draft->abilities = [$data['gameplay']['use']['ability']];
            $safe = app(CharacterGameplay::class)->abilities($draft, false, true)[0] ?? null;
            if ($safe) {
                $data['gameplay']['use']['ability'] = $safe;
            } else {
                unset($data['gameplay']['use']);
            }
        }

        return $data;
    }

    protected function casts(): array
    {
        return ['gameplay' => 'array', 'equipment_slots' => 'array', 'modifiers' => 'array', 'width' => 'integer', 'height' => 'integer', 'max_stack' => 'integer'];
    }
}
