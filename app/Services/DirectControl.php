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

    public const BATCH = 126;

    public const TTL = 1200;

    public function authorize(User $user, Token $token): void
    {
        Gate::forUser($user)->authorize('move', $token);
        abort_unless($token->kind === 'player_character' && ! $token->is_locked
            && $token->scene->campaign->active_scene_id === $token->scene_id, 422, 'Управление недоступно.');
        abort_if(Combat::where('scene_id', $token->scene_id)->where('status', 'active')->exists(), 422, 'WASD доступен только в исследовании.');
    }

    public function start(User $user, Token $token, string $id, bool $batching = false): array
    {
        $this->authorize($user, $token);
        $now = microtime(true) * 1000;
        $old = $token->direct_control;
        // Changing stream cannot mint fresh speed credit.
        $credit = min($batching ? self::BATCH : self::STEP * 2, ($old['credit'] ?? 0) + max(0, $now - ($old['at'] ?? $now)) * self::SPEED / 1000);
        $state = ['id' => $id, 'user' => $user->id, 'sequence' => 0, 'at' => $now,
            'expires' => $now + self::TTL, 'credit' => $credit, 'batching' => $batching, 'distance' => 0];
        $token->update(['direct_control' => $state]);

        return $this->receipt($token);
    }

    /** Only returned to the commanding client, never included in scene broadcasts. */
    public function receipt(Token $token): array
    {
        $state = $token->direct_control;

        return ['streamId' => $state['id'], 'acceptedSequence' => $state['sequence'],
            'position' => ['x' => (float) $token->x, 'y' => (float) $token->y],
            'maxBatchDistance' => ($state['batching'] ?? false) ? self::BATCH : self::STEP,
            'remainingCredit' => $state['credit'], 'acceptedDistance' => $state['distance'] ?? 0];
    }

    public function step(User $user, Token $token, array &$data): array
    {
        $this->authorize($user, $token);
        $state = $token->direct_control;
        $now = microtime(true) * 1000;
        abort_unless($state && $state['id'] === $data['streamId'] && $state['user'] === $user->id
            && $data['sequence'] === $state['sequence'] + 1 && $now <= $state['expires'], 409, 'Управление устарело.');
        abort_unless(abs($token->x - $data['origin']['x']) < 0.001 && abs($token->y - $data['origin']['y']) < 0.001, 409, 'Позиция изменилась.');
        $elapsed = max(0, $now - $state['at']);
        abort_if($elapsed < 100, 429, 'Слишком частые команды.');
        $batching = $state['batching'] ?? false;
        $limit = $batching ? self::BATCH : self::STEP;
        $credit = min($batching ? self::BATCH : self::STEP * 2, $state['credit'] + $elapsed * self::SPEED / 1000);
        $distance = 0;
        $accepted = [];
        $used = 0;
        $from = ['x' => (float) $token->x, 'y' => (float) $token->y];
        foreach ([...($data['waypoints'] ?? []), ['x' => $data['x'], 'y' => $data['y']]] as $to) {
            if ($token->scene->mapWorld) {
                $radius = TokenMovement::radius($token);
                abort_if($to['x'] < $radius || $to['y'] < $radius || $to['x'] > $token->scene->width - $radius || $to['y'] > $token->scene->height - $radius, 422, 'Перемещение недоступно.');
            }
            $length = hypot($to['x'] - $from['x'], $to['y'] - $from['y']);
            $distance += $length;
            if ($batching && $length > 0 && $used < $credit) {
                $take = min($length, $credit - $used);
                $point = $take === $length ? $to : [
                    'x' => round($from['x'] + ($to['x'] - $from['x']) * $take / $length, 3),
                    'y' => round($from['y'] + ($to['y'] - $from['y']) * $take / $length, 3)];
                $accepted[] = $point;
                $used += hypot($point['x'] - $from['x'], $point['y'] - $from['y']);
                // Stop at this prefix even if rounding leaves a fraction of credit.
                if ($take < $length) {
                    $used = max($used, $credit);
                }
            }
            $from = $to;
        }
        abort_if((! $batching && $distance > $credit + 0.002) || $distance > $limit + 0.002, 422, 'Перемещение недоступно.');
        if ($batching) {
            $end = array_pop($accepted) ?? ['x' => (float) $token->x, 'y' => (float) $token->y];
            $data['x'] = $end['x'];
            $data['y'] = $end['y'];
            $data['waypoints'] = $accepted;
            // Actual accepted polyline length, including rounded endpoint, drives reconciliation.
            $distance = 0;
            $from = ['x' => (float) $token->x, 'y' => (float) $token->y];
            foreach ([...$accepted, $end] as $point) {
                $distance += hypot($point['x'] - $from['x'], $point['y'] - $from['y']);
                $from = $point;
            }
        }

        return array_replace($state, ['sequence' => $data['sequence'], 'at' => $now,
            'expires' => $now + self::TTL, 'duration' => min($batching ? 700 : 400, max(150, $elapsed)),
            'distance' => $distance, 'credit' => max(0, $credit - $distance)]);
    }
}
