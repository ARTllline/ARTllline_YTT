<?php

namespace App\Actions;

use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

class NoteActions
{
    public function execute(User $user, Scene $scene, array $data): array
    {
        return app(SceneTransaction::class)->run($scene, function ($scene) use ($user, $data) {
            Gate::forUser($user)->authorize('update', $scene);
            $action = $data['action'];
            unset($data['action']);
            if ($action === 'create') {
                unset($data['id']);
                $note = SceneNote::create($data + ['scene_id' => $scene->id, 'created_by' => $user->id, 'title' => 'New note', 'body' => '', 'icon' => 'note']);
            } else {
                $note = SceneNote::where('scene_id', $scene->id)->findOrFail($data['id']);
                unset($data['id']);
                if ($action === 'delete') {
                    $note->delete();

                    return ['deletedNoteId' => (string) $note->id];
                }
                $note->update($data);
            }

            return ['note' => $note->refresh()->projection()];
        }, 'note.changed');
    }
}
