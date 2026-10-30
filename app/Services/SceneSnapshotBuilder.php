<?php

namespace App\Services;

use App\Actions\CharacterActions;
use App\Actions\ObjectInteractionActions;
use App\Combat\CombatStats;
use App\Combat\LifeCycle;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\LootContainer;
use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\SceneProp;
use App\Models\SceneRegion;
use App\Models\Token;
use App\Models\User;
use App\Spells\SpellEffects;
use App\Support\RequestPerformance;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SceneSnapshotBuilder
{
    public function build(Scene $scene, User $user): array
    {
        return app(RequestPerformance::class)->measure('snapshot', fn () => app(SpellEffects::class)->project(fn () => $this->buildMeasured($scene, $user)));
    }

    private function buildMeasured(Scene $scene, User $user): array
    {
        // Shared lock keeps the revision and its entities from different commits from being mixed.
        return DB::transaction(function () use ($scene, $user) {
            $campaign = Campaign::whereKey($scene->campaign_id)->sharedLock()->firstOrFail();
            $scene = Scene::whereKey($scene->id)->sharedLock()->firstOrFail();
            $scene->setRelation('campaign', $campaign);
            Gate::forUser($user)->authorize('view', $scene);
            $gm = $scene->campaign->roleFor($user) === 'gm';
            $tokens = $scene->tokens()->with(['character.portraitAsset', 'imageAsset', 'conditions'])->when(! $gm, fn ($query) => $query->where('is_hidden', false))->orderBy('z_index')->orderBy('id')->get();

            return [
                'id' => (string) $scene->id, 'campaignId' => (string) $scene->campaign_id,
                'name' => $scene->name, 'revision' => $scene->revision,
                'liveRevision' => $campaign->live_revision,
                'width' => $scene->width, 'height' => $scene->height,
                'fog' => ['base' => $scene->fog_base, 'actions' => $scene->fogActions()->get()->map(fn ($action) => $action->projection())->all()],
                'grid' => $this->grid($scene), 'map' => $this->map($scene),
                'tokens' => $tokens->map(fn ($token) => $this->token($token, $gm, $user))->all(),
                ...app(CharacterActions::class)->roster($campaign, $user),
                'props' => SceneProp::with('asset')->where('scene_id', $scene->id)->when(! $gm, fn ($q) => $q->where('is_hidden', false))->orderBy('z_index')->orderBy('id')->get()->map(fn ($p) => $p->projection($gm))->all(),
                'combat' => app(CombatView::class)->build($scene, $gm, $user),
                ...($gm ? ['regions' => SceneRegion::where('scene_id', $scene->id)->orderBy('id')->get()->map(fn ($r) => $r->projection())->all()] : []),
                ...($gm ? ['notes' => SceneNote::where('scene_id', $scene->id)->orderBy('id')->get()->map(fn ($n) => $n->projection())->all()] : []),
            ];
        });
    }

    public function grid(Scene $scene): array
    {
        return ['type' => 'square', 'size' => (float) $scene->grid_size,
            'offset' => ['x' => (float) $scene->grid_offset_x, 'y' => (float) $scene->grid_offset_y],
            'distancePerCell' => (float) $scene->distance_per_cell, 'distanceUnit' => $scene->distance_unit,
            'visible' => $scene->grid_visible, 'snap' => $scene->grid_snap];
    }

    public function asset(?Asset $asset): ?array
    {
        return $asset ? ['id' => (string) $asset->id, 'url' => PreloadService::url($asset),
            'width' => $asset->width, 'height' => $asset->height] : null;
    }

    public function map(Scene $scene): ?array
    {
        return $scene->map_asset_id ? ['asset' => $this->asset($scene->mapAsset),
            'x' => (float) $scene->map_x, 'y' => (float) $scene->map_y,
            'width' => (float) $scene->map_width, 'height' => (float) $scene->map_height] : null;
    }

    public function token(Token $token, bool $gm, User $user): array
    {
        return app(SpellEffects::class)->project(fn () => $this->tokenProjection($token, $gm, $user));
    }

    private function tokenProjection(Token $token, bool $gm, User $user): array
    {
        $loot = app(SpellEffects::class)->read('token-loot:'.$token->id, fn () => LootContainer::where('token_id', $token->id)->first());
        $data = [...($loot && ($gm || app(LifeCycle::class)->blocked($token)) ? ['loot' => $loot->summary($gm)] : []), 'id' => (string) $token->id, 'name' => $token->name,
            'characterId' => $token->character_id ? (string) $token->character_id : null,
            'interactions' => app(ObjectInteractionActions::class)->projection($token, $gm),
            'x' => (float) $token->x, 'y' => (float) $token->y, 'rotation' => (float) $token->rotation,
            'scale' => (float) $token->scale, 'size' => (float) $token->size,
            'kind' => $token->kind, 'disposition' => $token->disposition, 'color' => 9751480, 'image' => $this->asset($token->character_id ? $token->character->portraitAsset : $token->imageAsset),
            'canMove' => $gm || ($token->owner_user_id === $user->id && ! $token->is_locked && ! app(LifeCycle::class)->blocked($token))];
        $data['conditions'] = $token->conditions->filter(fn ($condition) => $gm || $condition->visibility === 'public')->values()->map(fn ($condition) => [
            'id' => (string) $condition->id, 'key' => $condition->key, 'label' => $condition->label,
            'compendiumEntryId' => $condition->compendium_entry_id, 'description' => app(CharacterCatalog::class)->entries('conditions')[$condition->key]['description'] ?? '',
            'durationMode' => $condition->duration_mode, 'remainingRounds' => $condition->remaining_rounds,
        ] + ($gm ? ['visibility' => $condition->visibility, 'sourceTokenId' => $condition->source_token_id ? (string) $condition->source_token_id : null] : []))->all();
        if ($gm || $token->owner_user_id === $user->id) {
            $data += ['lifecycle' => app(LifeCycle::class)->state($token), 'exhaustion' => $token->exhaustion, 'temporaryHp' => $token->temporary_hp ?? 0, 'hp' => $token->hp, 'maxHp' => $token->max_hp, 'checkStats' => $token->check_stats ?? []];
        }
        if (! $gm) {
            $data['isOwner'] = $token->owner_user_id === $user->id;
        }
        if ($gm) {
            $data['abilities'] = $token->character_id ? [] : ($token->abilities ?? []);
            $data['combatProfile'] = app(CombatStats::class)->profile($token);
            if ($token->character_id) {
                $data += ['baseAc' => $token->character->getRawOriginal('ac'), 'baseSpeed' => $token->character->getRawOriginal('speed')];
            }
            $data += ['lifecycle' => app(LifeCycle::class)->state($token), 'exhaustion' => $token->exhaustion, 'temporaryHp' => $token->temporary_hp ?? 0, 'hp' => $token->hp, 'maxHp' => $token->max_hp, 'ac' => $token->ac, 'speed' => $token->speed,
                'isHidden' => $token->is_hidden, 'isLocked' => $token->is_locked,
                'ownerUserId' => $token->owner_user_id ? (string) $token->owner_user_id : null];
        }

        return $data;
    }
}
