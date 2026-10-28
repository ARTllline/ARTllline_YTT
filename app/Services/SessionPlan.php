<?php

namespace App\Services;

use App\Models\Campaign;
use App\Models\ContentTemplate;
use App\Models\Cue;
use App\Models\GameSession;
use App\Models\Handout;
use App\Models\Scene;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class SessionPlan
{
    public const REFERENCES = ['scene' => 'scene_id', 'cue' => 'cue_id', 'handout' => 'handout_id', 'encounter' => 'content_template_id'];

    public function reference(Campaign $campaign, string $type, mixed $id): mixed
    {
        if (! $id) {
            return null;
        }

        return match ($type) {
            'scene' => Scene::where('campaign_id', $campaign->id)->find($id),
            'cue' => Cue::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id))->find($id),
            'handout' => Handout::where('campaign_id', $campaign->id)->find($id),
            'encounter' => ContentTemplate::where('campaign_id', $campaign->id)->where('kind', 'encounter')->find($id),
            default => null,
        };
    }

    public function validate(Campaign $campaign, array $input): array
    {
        $data = Validator::make($input, [
            'name' => 'required|string|max:160', 'planRevision' => 'required|integer|min:0',
            'items' => 'present|array|max:200', 'items.*.id' => 'required|uuid|distinct',
            'items.*.type' => ['required', Rule::in(['scene', 'cue', 'handout', 'encounter', 'note', 'chapter'])],
            'items.*.referenceId' => 'nullable|integer|min:1', 'items.*.title' => 'nullable|string|max:160',
            'items.*.notes' => 'nullable|string|max:4000',
        ])->validate();
        foreach ($data['items'] as $item) {
            if (isset(self::REFERENCES[$item['type']]) && ! empty($item['referenceId'])) {
                abort_unless($this->reference($campaign, $item['type'], $item['referenceId']), 422, 'Выберите материал из этой кампании.');
            }
        }

        return $data;
    }

    public function view(GameSession $session, bool $items = true): array
    {
        $data = ['id' => (string) $session->id, 'name' => $session->name, 'status' => $session->status,
            'planRevision' => $session->plan_revision, 'currentItemId' => $session->current_item_id,
            'autoPreload' => $session->auto_preload, 'startedAt' => $session->started_at?->toISOString(), 'endedAt' => $session->ended_at?->toISOString()];
        if (! $items) {
            return $data;
        }
        $campaign = Campaign::findOrFail($session->campaign_id);
        $data['notes'] = $session->notes ?? '';
        // One bounded query per reference type, not one lookup for every beat.
        $references = [];
        foreach (self::REFERENCES as $type => $column) {
            $ids = $session->items->where('type', $type)->pluck($column)->filter()->all();
            $references[$type] = (match ($type) {
                'scene' => Scene::where('campaign_id', $campaign->id),
                'cue' => Cue::whereHas('scene', fn ($q) => $q->where('campaign_id', $campaign->id)),
                'handout' => Handout::where('campaign_id', $campaign->id),
                'encounter' => ContentTemplate::where('campaign_id', $campaign->id)->where('kind', 'encounter'),
            })->whereIn('id', $ids)->get()->keyBy('id');
        }
        $data['items'] = $session->items->map(function ($item) use ($references) {
            $id = isset(self::REFERENCES[$item->type]) ? $item->{self::REFERENCES[$item->type]} : null;
            $ref = isset($references[$item->type]) ? $references[$item->type]->get($id) : null;

            return ['id' => $item->id, 'type' => $item->type, 'referenceId' => $id ? (string) $id : null,
                'title' => $item->title ?? '', 'notes' => $item->notes ?? '', 'name' => $ref?->name ?? $ref?->title ?? '',
                'sceneId' => $item->type === 'cue' ? (string) $ref?->scene_id : null,
                'missing' => isset(self::REFERENCES[$item->type]) && ! $ref];
        })->all();

        return $data;
    }
}
