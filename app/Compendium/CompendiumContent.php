<?php

namespace App\Compendium;

use App\Compendium\Unified\UnifiedReview;
use App\Compendium\Unified\UnifiedSrdAdapter;
use App\Items\ItemRarity;
use App\Items\ItemRules;
use App\Models\CompendiumCopy;
use App\Models\CompendiumEntry;
use App\Models\ItemDefinition;
use App\Models\User;
use App\Spells\SpellProjection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/** One compatibility boundary for catalog consumers and immutable copy receipts. */
class CompendiumContent
{
    public function unified(CompendiumEntry $entry): bool
    {
        return $entry->normalization_version !== CompendiumSync::VERSION || isset($entry->raw_data['record']) || isset($entry->normalized_data['content']['source_id']);
    }

    public function gates(CompendiumEntry $entry): array
    {
        if (! $this->unified($entry)) {
            return ['browse' => true, 'copy' => true, 'execute' => true];
        }
        $n = $entry->normalized_data;
        $data = $entry->only(['entity_type', 'external_key', 'name', 'checksum', 'normalization_version', 'normalized_data']);
        $review = data_get($n, 'content.review.local');
        $valid = $entry->source->key === 'srd-2024' && data_get($n, 'content.ruleset') === 'dnd-2024'
            && in_array(data_get($n, 'content.adapter_version'), UnifiedSrdAdapter::SUPPORTED_VERSIONS, true)
            && $entry->checksum === UnifiedSrdAdapter::checksum($entry->raw_data)
            && UnifiedReview::approved($review, $entry->checksum, UnifiedReview::projection($data));
        if (! $valid) {
            return ['browse' => false, 'copy' => false, 'execute' => false];
        }
        $profile = CompendiumExecution::profile($data);
        $copy = $valid && ($review['copy'] ?? false) === true;

        return ['browse' => (bool) $valid, 'copy' => (bool) $copy,
            'execute' => $copy && ($review['execute'] ?? false) === true && $profile['supported']
                && ($review['execution_checksum'] ?? null) === $profile['checksum']];
    }

    public function require(CompendiumEntry $entry, string $gate): void
    {
        abort_unless($this->gates($entry)[$gate], 422, 'Запись Compendium не подтверждена для этого действия или изменена после проверки.');
    }

    public function browseQuery(Builder $query): Builder
    {
        // SQL prefilter keeps pending content out of pagination; full checks follow.
        $query->where(fn ($q) => $q->where(fn ($legacy) => $legacy->where('normalization_version', CompendiumSync::VERSION)->whereNull('normalized_data->content->source_id')->whereNull('raw_data->record'))
            ->orWhere(fn ($u) => $u->where('normalized_data->content->review->gates->browse', true)
                ->whereColumn('checksum', 'normalized_data->content->review->local->checksum')));
        // Only the small controlled Unified selection needs payload verification.
        // Exclude stale projections before paginate(), including its total count.
        $candidates = (clone $query)->where(fn ($u) => $u->where('normalization_version', '!=', CompendiumSync::VERSION)->orWhereNotNull('raw_data->record')->orWhereNotNull('normalized_data->content->source_id'))->get();
        $invalid = $candidates->filter(fn ($e) => ! $this->gates($e)['browse'])->modelKeys();

        return $invalid ? $query->whereNotIn('id', $invalid) : $query;
    }

    public function normalized(CompendiumEntry $entry): array
    {
        if ($this->unified($entry) || ! in_array($entry->entity_type, ['items', 'weapons', 'armor'], true)) {
            return $entry->normalized_data;
        }

        return array_replace($entry->normalized_data, app(SrdEquipmentMapper::class)->map($entry->raw_data));
    }

    public function reference(CompendiumEntry $entry): array
    {
        $source = $entry->source;
        $n = $entry->normalized_data;

        return ['key' => $source->key, 'version' => $source->version, 'license' => $source->license,
            'external_key' => $entry->external_key, 'normalization_version' => $entry->normalization_version,
            'attribution' => $source->metadata['attribution'] ?? '', 'source_url' => $source->source_url,
            'ruleset' => data_get($n, 'content.ruleset', $source->key === 'srd-2024' ? 'dnd-2024' : null),
            'rules_revision' => data_get($n, 'content.rules_revision_claim', $source->version),
            'export' => data_get($n, 'content.export'), 'checksum' => $entry->checksum,
            'localized' => data_get($n, 'content.languages.ru'),
            'facts' => $this->facts($entry),
            'catalog_type' => $entry->entity_type,
            'rarity_text' => $n['rarity'] ?? null,
            'range_text' => $entry->entity_type === 'spells' ? ($n['range']['text'] ?? null) : null,
            'projection_checksum' => $this->unified($entry) ? UnifiedReview::projection($entry->only(['entity_type', 'external_key', 'name', 'checksum', 'normalization_version', 'normalized_data'])) : null,
            'gates' => $this->gates($entry), 'reference' => $n['description'] ?? '',
            'gm_required' => $this->notes($entry)];
    }

    private function facts(CompendiumEntry $entry): array
    {
        $n = $this->normalized($entry);
        $facts = [];
        if (isset($n['rarity'])) {
            $facts[] = 'Редкость по источнику: '.$n['rarity'];
        }
        if ($category = $n['category'] ?? null) {
            $facts[] = 'Категория по источнику: '.match ($category) {
                'weapon' => 'Оружие', 'armor' => 'Броня', default => ($n['subtype'] ?? null) === 'magic_item' ? 'Магический предмет' : 'Снаряжение',
            };
        }
        if ($cost = $n['cost'] ?? null) {
            $facts[] = 'Цена: '.$cost['quantity'].' '.$cost['unit'];
        }
        if ($weight = $n['weight'] ?? null) {
            $facts[] = 'Вес: '.$weight['value'].' '.$weight['unit'];
        }
        if ($armor = $n['armor'] ?? null) {
            $facts[] = ($armor['ac_semantics'] === 'bonus' ? 'Бонус AC: +'.$armor['ac_bonus'] : 'Базовый AC: '.$armor['base_ac'].(! empty($armor['add_dex']) ? ' + Dex' : ''));
        }
        if ($damage = data_get($n, 'damage.expression')) {
            $facts[] = 'Урон по источнику: '.$damage.' '.data_get($n, 'damage.damage_type');
        }
        if ($range = $n['range'] ?? null) {
            if (isset($range['normal'])) {
                $facts[] = 'Дистанция по источнику: '.$range['normal'].(isset($range['long']) ? ' / '.$range['long'] : '').' ft';
            }
        }
        if (! empty($n['weapon_properties'])) {
            $facts[] = 'Свойства по источнику: '.implode(', ', $n['weapon_properties']);
        }
        if ($mastery = $n['weapon_mastery'] ?? null) {
            $facts[] = 'Mastery по источнику: '.$mastery;
        }
        if ($ammo = $n['ammunition'] ?? null) {
            $facts[] = 'Боеприпасы по источнику: '.$ammo;
        }
        if ($quantity = data_get($entry->raw_data, 'record.raw.quantity')) {
            $facts[] = 'В упаковке: '.$quantity.'; количество выдачи задаётся отдельно.';
        }

        return $facts;
    }

    private function notes(CompendiumEntry $entry): array
    {
        if (! $this->unified($entry)) {
            return [];
        }
        $notes = ['Неподдерживаемые условия и эффекты разрешает GM; текст не исполняется автоматически.'];
        if (! $this->gates($entry)['execute']) {
            $notes[] = 'Требует решения GM: автоматическое исполнение этой копии не одобрено.';
        }
        if ($entry->entity_type === 'spells') {
            $coverage = app(SpellProjection::class)->coverage($entry->external_key);
            if (($coverage['status'] ?? 'MANUAL') !== 'FULL') {
                $notes[] = $coverage['reason'];
            }
        } else {
            $notes[] = 'Mastery, training и условные свойства предметов не становятся новыми автоматическими эффектами.';
        }

        return $notes;
    }

    public function ability(CompendiumEntry $entry, int $order = 0): array
    {
        $this->require($entry, 'browse');
        $n = $this->normalized($entry);
        $a = app(SpellProjection::class)->ability($n + ['source_key' => $entry->external_key, 'source_entry_id' => $entry->id], $order);
        $a['icon'] = $entry->visualIcon() ?? 'spark';
        if ($this->unified($entry)) {
            $a['spell']['content'] = $this->reference($entry);
            if (! $a['spell']['content']['gates']['execute']) {
                unset($a['attack'], $a['save'], $a['damage_components'], $a['condition_effects'], $a['spell']['scaling'], $a['spell']['cantrip_dice']);
                $a['damage'] = null;
                $a['result'] = ['type' => 'nothing', 'target' => null, 'amount' => 0];
                $a['category'] = 'effect';
                $a['target'] = 'none';
                $distance = $n['range']['distance'] ?? (($n['range']['kind'] ?? null) === 'touch' ? 5 : null);
                $a['range'] = $distance === null ? null : ['normal' => $distance, 'long' => null];
                $a['area'] = null;
                $a['spell']['coverage'] = 'MANUAL';
                $a['spell']['effects'] = [];
                $a['spell']['manual_allowed'] = false;
                $a['spell']['reasons'] = $a['spell']['content']['gm_required'];
            }
        }

        if (isset($a['spell']['content']) && $a['spell']['content']['gates']['execute'] && ($id = BasicExecutionProfiles::identify($a))) {
            $a['spell']['content']['execution_profile'] = BasicExecutionProfiles::reference($id);
        }

        return $a;
    }

    public function item(CompendiumEntry $entry, ?int $campaignId = null): ItemDefinition
    {
        $this->require($entry, 'browse');
        $n = $this->normalized($entry);
        $mapped = ItemRules::fromCompendium($n);
        $reference = $this->unified($entry) ? $this->reference($entry) : null;
        if ($reference && ! $reference['gates']['execute']) {
            $mapped = ['category' => 'adventuring_gear', 'gameplay' => ['source_key' => $n['key']], 'max_stack' => 1, 'equipment_slots' => []];
        }
        $category = $mapped['category'];
        $rarity = ItemRarity::fromSource($n['rarity'] ?? 'common');

        $definition = (new ItemDefinition)->forceFill(['campaign_id' => $campaignId,
            'name' => Str::limit($n['name'], 80, ''), 'description' => Str::limit($n['description'] ?? '', 1000, ''),
            'icon' => $entry->visualIcon() ?? match ($category) {
                'weapon' => 'item_sword', 'armor' => 'item_armor', 'shield' => 'item_shield', 'consumable' => 'item_potion', default => 'book'
            },
            'category' => $category, 'rarity' => $rarity,
            'width' => 1, 'height' => 1, 'max_stack' => $mapped['max_stack'], 'equipment_slots' => $mapped['equipment_slots'],
            'gameplay' => $mapped['gameplay'], 'compendium_entry_id' => $entry->id,
            'modifiers' => [], 'use_ability_id' => null]);
        if ($reference) {
            $definition->content = $reference;
        }

        if ($reference && $reference['gates']['execute'] && ($id = BasicExecutionProfiles::identify($definition))) {
            $definition->content = $reference + ['execution_profile' => BasicExecutionProfiles::reference($id)];
        }

        return $definition;
    }

    public function receipt(CompendiumEntry $entry, User $user, string $type, string $key, ?int $campaignId = null, ?int $characterId = null): CompendiumCopy
    {
        $owner = ($this->unified($entry) || $campaignId === null) && Schema::hasColumn('compendium_copies', 'owner_user_id') ? ['owner_user_id' => $user->id] : [];
        abort_if($campaignId === null && ! $owner, 503, 'Копирование из Compendium пока недоступно.');

        return CompendiumCopy::create($owner + ['campaign_id' => $campaignId,
            'compendium_entry_id' => $entry->id, 'character_id' => $characterId, 'target_type' => $type, 'target_key' => $key,
            'source_checksum' => $entry->checksum, 'source_reference' => $this->reference($entry),
            'snapshot' => ['raw_data' => $entry->raw_data, 'normalized_data' => $entry->normalized_data], 'created_at' => now()]);
    }

    public static function validateAbility(array $ability): void
    {
        if (data_get($ability, 'spell.content.gates.execute') === false) {
            abort_unless(data_get($ability, 'spell.coverage') === 'MANUAL' && ($ability['target'] ?? '') === 'none'
                && empty($ability['damage_components']) && empty($ability['damage']) && empty($ability['attack']) && empty($ability['save'])
                && empty($ability['condition_effects']) && empty($ability['spell']['effects']) && empty($ability['spell']['scaling'])
                && data_get($ability, 'result.type') === 'nothing', 422, 'Эта копия справочная: автоматические эффекты не одобрены; требуется решение GM.');
        }
    }
}
