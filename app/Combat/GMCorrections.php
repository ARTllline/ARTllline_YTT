<?php

namespace App\Combat;

use App\Actions\CharacterActions;
use App\Models\Scene;
use App\Models\SpellEffect;
use App\Models\Token;
use App\Models\User;
use App\Services\SceneSnapshotBuilder;
use Illuminate\Support\Facades\DB;

/** A bounded undo journal for manual vitals/conditions, never a gameplay rollback. */
class GMCorrections
{
    public function state(Token $token): array
    {
        $token = $token->fresh();
        $owner = $token->character_id ? $token->character : $token;

        return ['hp' => $token->hp, 'temporaryHp' => (int) $owner->temporary_hp,
            'conditions' => $token->conditions()->orderBy('id')->get()->map(fn ($c) => $c->getRawOriginal())->all()];
    }

    public function effects(Scene $scene): array
    {
        return SpellEffect::where('scene_id', $scene->id)->whereNull('ended_at')->orderBy('id')->get()->map(fn ($e) => $e->getRawOriginal())->all();
    }

    public function record(User $user, Token $token, string $command, array $before, array $effects): void
    {
        $combat = app(TurnBudget::class)->active($token->scene_id);
        $after = $this->state($token);
        if (! $combat || $before === $after) {
            return;
        }
        app(CombatLog::class)->write($combat, 'gm.correction', ['tokenId' => (string) $token->id, 'name' => $token->name,
            'operation' => $command, 'userId' => $user->id, 'before' => $before, 'after' => $after,
            'revision' => Scene::findOrFail($token->scene_id)->revision + 1,
            'reversible' => $effects === $this->effects($token->scene)]);
    }

    public function available(Scene $scene): ?object
    {
        $combat = app(TurnBudget::class)->active($scene->id);
        $event = $combat ? DB::table('combat_events')->where('combat_id', $combat->id)->where('type', 'gm.correction')->latest('id')->first() : null;
        if (! $event) {
            return null;
        }
        $d = json_decode($event->data, true);
        $token = $scene->tokens()->find($d['tokenId']);

        // MySQL JSON objects reorder keys; compare their values, not PHP insertion order.
        return $d['reversible'] && $scene->revision === $d['revision'] && $token && $this->state($token) == $d['after'] ? $event : null;
    }

    public function undo(User $user, Scene $scene, string $id): array
    {
        $event = $this->available($scene);
        abort_unless($event && (string) $event->id === $id, 409, 'Сцена изменилась. Отмена доступна только сразу после безопасной коррекции.');
        $d = json_decode($event->data, true);
        $token = $scene->tokens()->findOrFail($d['tokenId']);
        $owner = $token->character_id ? $token->character : $token;
        $owner->update(['hp' => $d['before']['hp'], 'temporary_hp' => $d['before']['temporaryHp']]);
        $token->conditions()->delete();
        if ($d['before']['conditions']) {
            DB::table('token_conditions')->insert($d['before']['conditions']);
        }
        if ($token->character_id) {
            app(CharacterActions::class)->updateLinked($user, $token, ['hp' => $d['before']['hp']]);
        }
        app(CombatLog::class)->write(app(TurnBudget::class)->active($scene->id), 'gm.undo', ['tokenId' => (string) $token->id, 'name' => $token->name, 'correctionId' => $id, 'userId' => $user->id]);

        return ['token' => app(SceneSnapshotBuilder::class)->token($token->fresh(), true, $user), '_combatChanged' => true, 'charactersChanged' => true, '_wasVisible' => ! $token->is_hidden];
    }
}
