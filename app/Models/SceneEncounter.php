<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/** Preparation only. Vitals, placement and visibility belong to the referenced tokens. */
class SceneEncounter extends Model
{
    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['groups' => 'array'];
    }

    public static function projections(Scene $scene, ?array $ids = null): array
    {
        $encounters = static::where('scene_id', $scene->id)->when($ids !== null, fn ($q) => $q->whereIn('id', $ids))->orderBy('id')->get();
        $members = DB::table('scene_encounter_members')->whereIn('encounter_id', $encounters->modelKeys())->orderBy('token_id')->get();

        return $encounters->map(fn ($e) => ['id' => $e->id, 'name' => $e->name, 'status' => $members->where('encounter_id', $e->id)->where('group_id', 'main')->isEmpty() ? 'draft' : $e->status,
            'groups' => array_map(fn ($g) => $g + ['tokenIds' => $members->where('encounter_id', $e->id)->where('group_id', $g['id'])->pluck('token_id')->map(strval(...))->all()], $e->groups)])->all();
    }

    public static function forTokens(array $ids): array
    {
        return DB::table('scene_encounter_members')->whereIn('token_id', $ids)->distinct()->pluck('encounter_id')->all();
    }
}
