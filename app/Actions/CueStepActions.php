<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Combat;
use App\Models\CueRun;
use App\Models\CueRunStep;
use App\Models\Scene;
use App\Models\SceneProp;
use App\Models\User;
use App\Realtime\CommandContext;
use App\Realtime\DirectorPublisher;
use App\Services\CueDefinition;
use App\Services\MediaConfig;
use Illuminate\Support\Str;

/** Orchestration adapters only: canonical mutations remain in their existing actions. */
class CueStepActions
{
    public function execute(Campaign $campaign, Scene $scene, CueRun $run, CueRunStep $step): int
    {
        $user = User::findOrFail($run->created_by);
        $data = app(CueDefinition::class)->config($scene, $step->type, $step->config);
        $context = app(CommandContext::class);
        $context->socketId = $context->dragSessionId = null;
        $context->mutationId = $step->id;
        if (in_array($step->type, MediaConfig::TYPES)) {
            app(MediaActions::class)->execute($user, $campaign, $step->type, $data + ['sceneId' => (string) $scene->id, 'epoch' => $run->epoch]);

            return 0;
        }
        switch ($step->type) {
            case 'objects.reveal':
            case 'objects.hide':
                foreach ($data['tokenIds'] as $id) {
                    $context->mutationId = (string) Str::uuid();
                    app(TokenActions::class)->update($user, $scene->tokens()->findOrFail($id), ['is_hidden' => $step->type === 'objects.hide']);
                }
                foreach ($data['propIds'] as $id) {
                    $context->mutationId = (string) Str::uuid();
                    app(PropActions::class)->execute($user, $scene, ['action' => 'update', 'id' => $id, 'patch' => ['is_hidden' => $step->type === 'objects.hide']]);
                }
                break;
            case 'object.move':
                $patch = ['x' => $data['x'], 'y' => $data['y']];
                if ($data['kind'] === 'token') {
                    app(TokenActions::class)->update($user, $scene->tokens()->findOrFail($data['id']), $patch);
                } else {
                    app(PropActions::class)->execute($user, $scene, ['action' => 'update', 'id' => $data['id'], 'patch' => $patch]);
                }
                break;
            case 'prefab.spawn':
            case 'encounter.spawn':
                $spawn = app(TemplateActions::class)->spawn($user, $scene, $data);
                if ($step->type === 'encounter.spawn' && (($data['addToCombat'] ?? false) || ($data['startCombat'] ?? false))) {
                    $this->combat($user, $scene, 'add', array_column($spawn['tokens'], 'id'));
                    if ($data['startCombat'] ?? false) {
                        $this->combat($user, $scene, 'begin');
                    }
                }
                break;
            case 'combat.add':
            case 'combat.begin':
            case 'combat.end':
            case 'combat.next':
                $this->combat($user, $scene, substr($step->type, 7), $data['tokenIds'] ?? []);
                break;
            case 'handout.show':
                app(HandoutActions::class)->show($user, $campaign, (string) $data['handoutId']);
                break;
            case 'wait':
                return $data['duration'];
            default:
                if ($step->type === 'camera.focus' && $data['kind'] !== 'point') {
                    $target = $data['kind'] === 'token' ? $scene->tokens()->findOrFail($data['id']) : SceneProp::where('scene_id', $scene->id)->findOrFail($data['id']);
                    abort_if($target->is_hidden, 422, 'Сначала покажите цель игрокам, затем наводите камеру.');
                    $data['x'] = (float) $target->x;
                    $data['y'] = (float) $target->y;
                }
                unset($data['kind'], $data['id']);
                app(DirectorPublisher::class)->send($campaign, $run, $step->id, $step->type, $data);

                return $data['duration'] ?? 0;
        }

        return 0;
    }

    private function combat(User $user, Scene $scene, string $command, array $tokenIds = []): void
    {
        $actions = app(CombatActions::class);
        $combat = Combat::where('scene_id', $scene->id)->whereIn('status', ['preparing', 'active'])->first();
        if (! $combat && $command === 'add') {
            app(CommandContext::class)->mutationId = (string) Str::uuid();
            $actions->execute($user, $scene, 'prepare', []);
            $combat = Combat::where('scene_id', $scene->id)->where('status', 'preparing')->firstOrFail();
        }
        abort_unless($combat, 422, 'Сначала добавьте участников боя.');
        if ($command === 'begin' && $combat->status === 'active') {
            return;
        }
        app(CommandContext::class)->mutationId = (string) Str::uuid();
        $actions->execute($user, $scene, $command, ['combatId' => (string) $combat->id, 'tokenIds' => $tokenIds,
            'expectedRound' => $combat->round, 'expectedCurrentCombatantId' => $combat->current_combatant_id]);
    }
}
