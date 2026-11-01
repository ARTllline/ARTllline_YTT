<?php

namespace App\Actions;

use App\Models\Campaign;
use App\Models\Character;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\User;
use App\Services\CharacterGameplay;
use App\Spells\SpellProjection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/** Global Compendium templates -> independent Character runtime snapshots. */
class SpellLibrary
{
    public function template(CompendiumEntry $entry): array
    {
        if ($entry->library_user_id) {
            $a = $entry->normalized_data['ability'];
            $a['id'] = (string) Str::uuid();
            $a['spell']['source_entry_id'] = $entry->id;

            return $a;
        }
        return app(SpellProjection::class)->ability([
            ...$entry->normalized_data, 'source_key' => $entry->external_key, 'source_entry_id' => $entry->id,
        ], 0);
    }

    public function save(User $user, array $data): array
    {
        $entry = isset($data['id'])
            ? CompendiumEntry::where('library_user_id', $user->id)->where('entity_type', 'spells')->findOrFail($data['id'])
            : new CompendiumEntry;
        $origin = $entry->normalized_data['origin'] ?? null;
        if (! $entry->exists && isset($data['copyFrom'])) {
            $parent = CompendiumEntry::with('source')->where('entity_type', 'spells')
                ->where(fn ($q) => $q->whereNull('library_user_id')->orWhere('library_user_id', $user->id))
                ->findOrFail($data['copyFrom']);
            $origin = $parent->normalized_data['origin'] ?? $this->projection($parent)['source'];
        }
        $payload = Validator::make(['abilities' => [$data['ability']]], CharacterGameplay::rules())->validate();
        abort_unless(isset($payload['abilities'][0]['spell']), 422, 'Требуются параметры заклинания.');
        app(CharacterGameplay::class)->validate(null, $payload, null);
        $a = $payload['abilities'][0];
        unset($a['spell']['source_entry_id']);
        $key = $entry->external_key ?? (string) Str::uuid();
        $entry->fill([
            'source_id' => CompendiumSource::where('key', 'custom-library')->firstOrFail()->id,
            'library_user_id' => $user->id, 'entity_type' => 'spells', 'external_key' => $key,
            'slug' => $key, 'name' => $a['name'], 'raw_data' => [],
            'normalized_data' => ['ability' => $a, 'spell_level' => $a['spell']['level'], 'school' => $a['spell']['school'], 'origin' => $origin],
            'checksum' => hash('sha256', json_encode($a)), 'normalization_version' => 1, 'imported_at' => now(),
        ])->save();

        return ['entry' => $this->projection($entry->load('source'))];
    }

    public function projection(CompendiumEntry $e): array
    {
        return ['id' => $e->id, 'custom' => (bool) $e->library_user_id, 'ability' => $this->template($e),
            'source' => $e->normalized_data['origin'] ?? ['name' => $e->source->name, 'version' => $e->source->version, 'license' => $e->source->license,
                'attribution' => $e->source->metadata['attribution'] ?? '', 'url' => $e->source->source_url]];
    }

    public function command(User $user, Character $character, array $data): array
    {
        return DB::transaction(function () use ($user, $character, $data) {
            $c = app(CharacterLibrary::class)->find($user, $character->id);
            $campaign = $c->campaign_id ? Campaign::whereKey($c->campaign_id)->lockForUpdate()->firstOrFail() : null;
            if ($campaign) {
                Gate::forUser($user)->authorize('update', $campaign);
            }
            $c = app(CharacterLibrary::class)->query($user)->whereKey($c->id)->lockForUpdate()->firstOrFail();
            abort_if($c->campaign_id !== $campaign?->id, 409, 'Назначение изменилось. Обновите персонажа.');
            $abilities = $c->abilities ?? [];
            if ($data['action'] === 'add') {
                $entry = CompendiumEntry::where('entity_type', 'spells')
                    ->where(fn ($q) => $q->whereNull('library_user_id')->orWhere('library_user_id', $user->id))
                    ->whereKey($data['entryId'])->sharedLock()->firstOrFail();
                // Double-clicks/retries must never create a second assignment of the same template.
                if (! collect($abilities)->contains(fn ($a) => ($a['spell']['source_entry_id'] ?? null) === $entry->id)) {
                    abort_if(count($abilities) >= 24, 422, 'У персонажа уже 24 способности.');
                    $ability = $this->template($entry);
                    $ability['sort_order'] = min(100, count($abilities));
                    $abilities[] = $ability;
                }
            } else {
                $index = collect($abilities)->search(fn ($a) => $a['id'] === $data['abilityId']);
                abort_if($index === false, 404);
                if ($data['action'] === 'remove') {
                    array_splice($abilities, $index, 1);
                } else {
                    abort_unless(isset($abilities[$index]['spell']), 422);
                    foreach (['known', 'prepared', 'available', 'manual_allowed'] as $key) {
                        if (array_key_exists($key, $data)) {
                            $abilities[$index]['spell'][$key] = $data[$key];
                        }
                    }
                }
            }
            $update = ['abilities' => array_values($abilities)];
            Validator::make($update, CharacterGameplay::rules())->validate();
            app(CharacterGameplay::class)->validate($campaign, $update, $c);
            $c->update($update);
            app(CharacterActions::class)->publish($user, $c);

            return ['character' => app(CharacterActions::class)->projection($c)];
        }, 3);
    }
}
