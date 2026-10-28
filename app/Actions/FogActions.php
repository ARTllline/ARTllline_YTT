<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

class FogActions
{
    public function __construct(private SceneTransaction $transaction) {}

    public function append(User $user, Scene $scene, array $data): array
    {
        return $this->transaction->run($scene, function (Scene $scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $action = $scene->fogActions()->create($data + ['sequence' => $scene->revision + 1, 'created_by' => $user->id]);

            return ['fogAction' => $action->projection()];
        }, 'fog.action');
    }

    public function reset(User $user, Scene $scene, string $base): array
    {
        return $this->transaction->run($scene, function (Scene $scene) use ($user, $base) {
            Gate::forUser($user)->authorize('update', $scene);
            $scene->update(['fog_base' => $base]);
            $scene->fogActions()->delete();

            return ['fog' => ['base' => $base, 'actions' => []]];
        }, 'fog.reset');
    }
}
