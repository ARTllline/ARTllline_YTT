<?php

namespace App\Services;

use App\Models\Combat;
use App\Models\Token;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/** Bounded input stream; called under the existing campaign/scene writer lock. */
class DirectControl
{
    public const SPEED = 180;

    public const STEP = 36;

    public const TTL = 1200;

    public function authorize(User $user, Token $token): void
    {
        Gate::forUser($user)->authorize('move', $token);
        abort_unless($token->kind === 'player_character' && ! $token->is_locked
            && $token->scene->campaign->active_scene_id === $token->scene_id, 422, 'Управление недоступно.');
        abort_if(Combat::where('scene_id', $token->scene_id)->where('status', 'active')->exists(), 422, 'WASD доступен только в исследовании.');
    }

    public function start(User $user, Token $token, string $id): array
    {
        $this->authorize($user, $token);
        $now = microtime(true) * 1000;
        $old = $token->direct_control;
        // Changing stream cannot mint fresh speed credit.
        $credit = min(self::STEP * 2, ($old['credit'] ?? 0) + max(0, $now - ($old['at'] ?? $now)) * self::SPEED / 1000);
        $state = ['id' => $id, 'user' => $user->id, 'sequence' => 0, 'at' => $now,
            'expires' => $now + self::TTL, 'credit' => $credit];
        $token->update(['direct_control' => $state]);

        return ['streamId' => $id, 'position' => ['x' => (float) $token->x, 'y' => (float) $token->y]];
    }

    public function step(User $user, Token $token, array $data): array
    {
        $this->authorize($user, $token);
        $state = $token->direct_control;
        $now = microtime(true) * 1000;
        abort_unless($state && $state['id'] === $data['streamId'] && $state['user'] === $user->id
            && $data['sequence'] === $state['sequence'] + 1 && $now <= $state['expires'], 409, 'Управление устарело.');
        abort_unless(abs($token->x - $data['origin']['x']) < 0.001 && abs($token->y - $data['origin']['y']) < 0.001, 409, 'Позиция изменилась.');
        $elapsed = max(0, $now - $state['at']);
        abort_if($elapsed < 100, 429, 'Слишком частые команды.');
        $credit = min(self::STEP * 2, $state['credit'] + $elapsed * self::SPEED / 1000);
        $distance = 0;
        $from = ['x' => (float) $token->x, 'y' => (float) $token->y];
        foreach ([...($data['waypoints'] ?? []), ['x' => $data['x'], 'y' => $data['y']]] as $to) {
            if ($token->scene->mapWorld) {
                $radius = TokenMovement::radius($token);
                abort_if($to['x'] < $radius || $to['y'] < $radius || $to['x'] > $token->scene->width - $radius || $to['y'] > $token->scene->height - $radius, 422, 'Перемещение недоступно.');
            }
            $distance += hypot($to['x'] - $from['x'], $to['y'] - $from['y']);
            $from = $to;
        }
        abort_if($distance > $credit + 0.002 || $distance > self::STEP + 0.002, 422, 'Перемещение недоступно.');

        return array_replace($state, ['sequence' => $data['sequence'], 'at' => $now,
            'expires' => $now + self::TTL, 'duration' => min(400, max(150, $elapsed)), 'credit' => max(0, $credit - $distance)]);
    }
}
