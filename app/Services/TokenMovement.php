<?php

namespace App\Services;

use App\Combat\TurnBudget;
use App\Models\Token;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

class TokenMovement
{
    public const NORMAL = 'normal';
    public const EDIT = 'edit';
    public const TELEPORT = 'teleport';
    public const OVERRIDE = 'override';

    public static function radius(Token $token): float
    {
        return $token->size * $token->scale / 2;
    }

    /** Called under the scene write lock. Waypoints exclude both origin and destination. */
    public function resolve(User $user, Token $token, array $destination, array $waypoints = [], string $intent = self::NORMAL, ?array $shapes = null): array
    {
        abort_unless(in_array($intent, [self::NORMAL, self::EDIT, self::TELEPORT, self::OVERRIDE], true), 422);
        abort_if($waypoints && $intent !== self::NORMAL, 422);
        Gate::forUser($user)->authorize($intent === self::NORMAL ? 'move' : 'update', $token);
        $canonical = static fn ($point) => ['x' => round((float) $point['x'], 3), 'y' => round((float) $point['y'], 3)];
        $end = $canonical($destination);
        if (in_array($intent, [self::EDIT, self::OVERRIDE], true)) {
            return ['position' => $end, 'path' => []];
        }
        $origin = ['x' => (float) $token->x, 'y' => (float) $token->y];
        $from = $intent === self::TELEPORT ? $end : $origin;
        $segments = [];
        $length = 0;
        foreach ([...$waypoints, $end] as $point) {
            $to = $canonical($point);
            if ($from !== $to || $intent === self::TELEPORT) {
                $segments[] = [$from, $to];
                $length += hypot($to['x'] - $from['x'], $to['y'] - $from['y']);
            }
            $from = $to;
        }
        if ($intent === self::NORMAL) {
            // Rule-invalid paths never query private obstacles. A later collision
            // rolls back both the spend and its log under the same scene transaction.
            app(TurnBudget::class)->spendMovement($token, $length);
        }
        if ($segments) {
            $scene = $token->scene;
            // No early exit at a private waypoint. Pad the player collision phase
            // identically on success/failure to mask ordinary geometry timing.
            $deadline = $scene->campaign->roleFor($user) === 'player' ? hrtime(true) + 40_000_000 : 0;
            try {
                $shapes ??= $scene->mapWorld ? StructuralGeometry::forScene($scene)['shapes'] : [];
                $collision = app(MovementCollision::class);
                $radius = self::radius($token);
                $blocked = false;
                foreach ($segments as [$a, $b]) {
                    $blocked = $collision->blocks($a, $b, $radius, $shapes) || $blocked;
                }
            } finally {
                $remaining = $deadline - hrtime(true);
                if ($remaining > 0) {
                    usleep((int) ceil($remaining / 1000));
                }
            }
            abort_if($blocked, 422, 'Перемещение недоступно.');
        }

        return [
            'position' => $end,
            'path' => $intent === self::NORMAL && $segments ? [$origin, ...array_column($segments, 1)] : [],
        ];
    }
}
