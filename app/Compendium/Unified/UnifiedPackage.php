<?php

namespace App\Compendium\Unified;

use Illuminate\Support\Facades\Validator;
use InvalidArgumentException;

class UnifiedPackage
{
    public function __construct(private UnifiedJson $json) {}

    public function read(string $root, string $manifestPath): array
    {
        $manifest = $this->json->read($manifestPath, limit: 1048576);
        Validator::make($manifest, [
            'format' => 'required|integer|in:1', 'adapter_version' => 'required|integer|in:4,5',
            'source' => 'required|in:srd-2024', 'ruleset' => 'required|in:dnd-2024',
            'export' => 'required|array', 'export.srd_commit' => 'required|regex:/^[a-f0-9]{40}$/D',
            'export.library_version' => 'required|string|max:80',
            'selection' => 'required|array|min:1|max:20',
            'selection.*.id' => ['required', 'string', 'distinct', 'regex:/^srd:(equipment|magic_item|spell):[a-z0-9][a-z0-9-]*(?:\([a-z0-9-]+\))?:2024$/D'],
            'selection.*.kind' => 'required|in:equipment,magic_item,spell',
            'selection.*.entity_type' => 'required|in:items,weapons,armor,spells',
            'selection.*.external_key' => 'required|string|max:160',
            'selection.*.checksum' => 'required|regex:/^[a-f0-9]{64}$/D',
            'selection.*.content_checksum' => 'required_with:selection.*.correction|regex:/^[a-f0-9]{64}$/D',
            'selection.*.correction' => 'sometimes|array:evidence,fields',
            'selection.*.correction.evidence' => 'required_with:selection.*.correction|string|max:2000',
            'selection.*.correction.fields' => 'required_with:selection.*.correction|array:name_ru,description_ru,description_en|min:1',
            'selection.*.correction.fields.name_ru' => 'sometimes|string|max:255',
            'selection.*.correction.fields.description_ru' => 'sometimes|string|max:60000',
            'selection.*.correction.fields.description_en' => 'sometimes|string|max:60000',
            'reviews' => 'present|array|max:20', 'reviews.*.id' => 'required|string|distinct',
            'reviews.*.checksum' => 'required|regex:/^[a-f0-9]{64}$/D',
            'reviews.*.reviewer' => 'required|string|max:160', 'reviews.*.evidence' => 'required|string|max:2000',
            'reviews.*.browse' => 'required|boolean', 'reviews.*.copy' => 'required|boolean',
            'reviews.*.confirmed' => 'required|accepted',
            'reviews.*.projection_checksum' => 'required|regex:/^[a-f0-9]{64}$/D',
            'reviews.*.languages' => 'required|array|size:2', 'reviews.*.languages.*' => 'required|in:en,ru',
            'reviews.*.confirmed_at' => 'required|date_format:Y-m-d\TH:i:sP',
            'reviews.*.execute' => 'required|boolean',
            'reviews.*.execution_checksum' => 'sometimes|regex:/^[a-f0-9]{64}$/D',
            'baseline_reviews' => 'sometimes|array|max:20',
            'baseline_reviews.*' => 'array:id,policy,entry_id,baseline_digest,confirmed,confirmed_at,reviewer,evidence',
            'baseline_reviews.*.id' => 'required|string|distinct',
            'baseline_reviews.*.policy' => 'required|in:'.implode(',', UnifiedCatalogPlan::BASELINE_POLICIES),
            'baseline_reviews.*.entry_id' => 'required|integer|min:1',
            'baseline_reviews.*.baseline_digest' => 'required|regex:/^[a-f0-9]{64}$/D',
            'baseline_reviews.*.confirmed' => 'required|accepted',
            'baseline_reviews.*.confirmed_at' => 'required|date_format:Y-m-d\TH:i:sP',
            'baseline_reviews.*.reviewer' => 'required|string|max:160',
            'baseline_reviews.*.evidence' => 'required|string|max:2000',
        ])->validate();
        if (! array_is_list($manifest['selection']) || ! array_is_list($manifest['reviews'])) {
            throw new InvalidArgumentException('Selection and reviews must be lists.');
        }
        if ($manifest['format'] !== 1 || ! in_array($manifest['adapter_version'], UnifiedSrdAdapter::SUPPORTED_VERSIONS, true)) {
            throw new InvalidArgumentException('Unsupported manifest/adapter version.');
        }
        $ids = array_column($manifest['selection'], 'id');
        if (! array_is_list($manifest['baseline_reviews'] ?? [])) {
            throw new InvalidArgumentException('Baseline reviews must be a list.');
        }
        foreach ($manifest['baseline_reviews'] ?? [] as $baselineReview) {
            if (! in_array($baselineReview['id'], $ids, true) || ! str_starts_with($baselineReview['id'], 'srd:equipment:')
                || $baselineReview['confirmed'] !== true || ! is_int($baselineReview['entry_id'])) {
                throw new InvalidArgumentException('Invalid baseline review scope.');
            }
        }
        foreach ($manifest['reviews'] as $review) {
            if (! in_array($review['id'], $ids, true) || ! is_bool($review['browse']) || ! is_bool($review['copy']) || ! is_bool($review['execute']) || $review['confirmed'] !== true
                || ! array_is_list($review['languages']) || count(array_unique($review['languages'])) !== 2) {
                throw new InvalidArgumentException('Invalid local review scope.');
            }
            if ($review['execute'] && (! $review['copy'] || ! isset($review['execution_checksum']))) {
                throw new InvalidArgumentException('Execution needs separate profile checksum and copy approval.');
            }
        }
        $index = $this->json->read($this->json->inside($root, 'data/index.js'), 'acceptIndex');
        if (($index['schemaVersion'] ?? null) !== 1 || ($index['inputSchemas']['srd'] ?? null) !== 2
            || ($index['srdCommit'] ?? null) !== $manifest['export']['srd_commit']
            || ($index['srdLibraryVersion'] ?? null) !== $manifest['export']['library_version']
            || ! is_array($index['records'] ?? null) || ! array_is_list($index['records'])) {
            throw new InvalidArgumentException('Export schema/revision differs from manifest.');
        }
        $byId = [];
        foreach ($index['records'] as $row) {
            if (! is_array($row) || ! is_string($row['id'] ?? null) || isset($byId[$row['id']])) {
                throw new InvalidArgumentException('Missing or duplicate index identity.');
            }
            $byId[$row['id']] = $row;
        }
        $shards = [];
        $records = [];
        foreach ($manifest['selection'] as $selected) {
            $row = $byId[$selected['id']] ?? null;
            if (! $row || ($row['source'] ?? null) !== '2024' || ($row['kind'] ?? null) !== $selected['kind']
                || ! is_string($row['shard'] ?? null) || ! preg_match('/^\d{1,4}$/D', $row['shard'])) {
                throw new InvalidArgumentException('Selected identity/type/shard not found in SRD 2024 index.');
            }
            $shard = $row['shard'];
            $shards[$shard] ??= $this->json->read($this->json->inside($root, 'data/records-'.$shard.'.js'), 'acceptShard.bind(null,"'.$shard.'")');
            if (! is_array($shards[$shard][$selected['id']] ?? null)) {
                throw new InvalidArgumentException('Selected record missing from shard.');
            }
            $detail = $shards[$shard][$selected['id']];
            if (! is_array($detail['assets'] ?? null) || (isset($detail['relations']) && (! is_array($detail['relations']) || ! array_is_list($detail['relations'])))) {
                throw new InvalidArgumentException('Assets must be a mapping and relations a list.');
            }
            foreach ($detail['relations'] ?? [] as $relation) {
                if (! is_array($relation) || ! array_is_list($relation) || count($relation) !== 3 || ! is_string($relation[0]) || ! isset($byId[$relation[0]]) || ! is_string($relation[1])) {
                    throw new InvalidArgumentException('Broken relation target or shape.');
                }
            }
            $records[] = ['selection' => $selected, 'index' => $row, 'detail' => $detail];
        }

        return ['manifest' => $manifest, 'records' => $records];
    }
}
