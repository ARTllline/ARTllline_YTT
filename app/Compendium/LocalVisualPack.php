<?php

namespace App\Compendium;

use App\Compendium\Unified\UnifiedJson;
use App\Models\Asset;
use App\Models\CompendiumEntry;
use App\Models\CompendiumSource;
use App\Models\CompendiumVisual;
use App\Services\AssetThumbnail;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;

/** Optional local artwork only. Never invokes a content importer or edits source/copy data. */
class LocalVisualPack
{
    public const KEY = 'unified-dnd-local-v1';

    public const REVIEWS = ['preserved_compatible_exact', 'visually_reviewed', 'reviewed_semantic', 'manually_selected', 'reviewed_type_fallback'];

    public function __construct(private UnifiedJson $json) {}

    public function run(string $root, bool $apply = false): array
    {
        $index = $this->json->read($this->json->inside($root, 'data/index.js'), 'acceptIndex');
        if (($index['schemaVersion'] ?? null) !== 1 || ($index['inputSchemas']['srd'] ?? null) !== 2) {
            throw new InvalidArgumentException('Unsupported Unified Library schema.');
        }
        $rows = [];
        $seen = [];
        foreach ($index['records'] as $row) {
            if (isset($seen[$row['id']])) {
                throw new InvalidArgumentException('Duplicate source identity.');
            }
            $seen[$row['id']] = true;
            if (($row['source'] ?? null) === '2024') {
                $rows[$row['id']] = $row;
            }
        }
        // The export also contains thousands of BG3/2014 entries. Do not retain
        // their decoded arrays, or all record shards, during local installation.
        unset($index['records'], $seen);
        $shards = $images = $plan = [];
        $loadedShard = null;
        $counts = ['eligible' => 0, 'linked' => 0, 'unlinked' => 0, 'create' => 0, 'skip' => 0, 'unique_images' => 0];
        $reasons = $types = [];
        $entries = CompendiumEntry::with('source')->whereNull('library_user_id')->whereIn('entity_type', ['items', 'weapons', 'armor', 'spells'])->orderBy('id')->get();
        foreach ($entries as $entry) {
            if (! app(CompendiumContent::class)->gates($entry)['browse']) {
                continue;
            }
            $counts['eligible']++;
            $id = $this->identity($entry);
            $row = $rows[$id] ?? null;
            $reason = null;
            if (! $row || ($row['source'] ?? null) !== '2024') {
                $reason = 'no_exact_source_identity';
            } elseif (! ($row['icon'] ?? null)) {
                $reason = 'no_confirmed_image';
            } else {
                $shard = $row['shard'] ?? '';
                if (! is_string($shard) || ! preg_match('/^\d{1,4}$/D', $shard)) {
                    throw new InvalidArgumentException('Invalid shard.');
                }
                if ($loadedShard !== $shard) {
                    $shards = $this->json->read($this->json->inside($root, 'data/records-'.$shard.'.js'), 'acceptShard.bind(null,"'.$shard.'")');
                    $loadedShard = $shard;
                }
                $detail = $shards[$id] ?? [];
                $record = $detail['record'] ?? [];
                if ('srd:'.($record['stable_version_id'] ?? '') !== $id || ($record['edition'] ?? null) !== '2024'
                    || ($record['source']['index'] ?? null) !== (data_get($entry->raw_data, 'record.source.index') ?? ($entry->raw_data['index'] ?? null))
                    || (data_get($entry->raw_data, 'record.source') !== null
                        ? ($record['source'] ?? null) != data_get($entry->raw_data, 'record.source')
                        : ($record['source']['commit'] ?? null) !== ($index['srdCommit'] ?? null))
                    || ! in_array($row['kind'] ?? null, $entry->entity_type === 'spells' ? ['spell'] : ['equipment', 'magic_item'], true)
                    || ! str_starts_with($id, 'srd:'.$row['kind'].':')) {
                    throw new InvalidArgumentException('Source identity/type/revision mismatch: '.$id);
                }
                $review = $record['icon_review'] ?? [];
                $icon = $record['icon'] ?? [];
                if (($review['required'] ?? true) !== false || ! in_array($review['review_status'] ?? '', self::REVIEWS, true)
                    || ($review['no_compatible_candidate'] ?? false) || in_array($review['decision'] ?? '', ['rejected', 'unmatched'], true)) {
                    $reason = 'unconfirmed_visual_review';
                } else {
                    $sha = $icon['sha256'] ?? '';
                    if (! preg_match('/^[a-f0-9]{64}$/D', $sha) || $row['icon'] !== 'assets/'.$sha.'.png'
                        || ($detail['assets'][$icon['path'] ?? ''] ?? null) !== $row['icon'] || empty($icon['icon_id'] ?? $icon['source_id'] ?? null)) {
                        throw new InvalidArgumentException('Image metadata/path mismatch: '.$id);
                    }
                    if (! isset($images[$sha])) {
                        $path = $this->json->inside($root, $row['icon']);
                        $size = @getimagesize($path);
                        if (hash_file('sha256', $path) !== $sha || ! $size || $size[2] !== IMAGETYPE_PNG
                            || filesize($path) > 4 * 1024 * 1024 || max($size[0], $size[1]) > 2048) {
                            throw new InvalidArgumentException('Invalid or changed PNG: '.$id);
                        }
                        $decoded = @imagecreatefrompng($path);
                        if (! $decoded) {
                            throw new InvalidArgumentException('Undecodable PNG: '.$id);
                        }
                        imagedestroy($decoded);
                        $images[$sha] = ['path' => $path, 'width' => $size[0], 'height' => $size[1]];
                    }
                    $old = $entry->visual;
                    if ($old && ($old->pack !== self::KEY || $old->source_record_id !== $id || $old->image_sha256 !== $sha || $old->entry_checksum !== $entry->checksum)) {
                        throw new InvalidArgumentException('Existing binding differs; detach/review it explicitly: '.$id);
                    }
                    $plan[] = ['entry' => $entry, 'id' => $id, 'sha' => $sha, 'evidence' => [
                        'source_commit' => $index['srdCommit'], 'icon_id' => $icon['icon_id'] ?? $icon['source_id'],
                        'review' => $review, 'match_type' => $icon['match_type'] ?? null,
                    ]];
                    $counts[$old ? 'skip' : 'create']++;
                }
            }
            $counts[$reason ? 'unlinked' : 'linked']++;
            $types[$entry->entity_type][$reason ? 'unlinked' : 'linked'] = ($types[$entry->entity_type][$reason ? 'unlinked' : 'linked'] ?? 0) + 1;
            if ($reason) {
                $reasons[$reason] = ($reasons[$reason] ?? 0) + 1;
            }
        }
        $counts['unique_images'] = count($images);
        if ($apply) {
            $createdPaths = [];
            DB::transaction(function () use ($plan, $images, &$createdPaths) {
                // Shared installation mutex, also used by detach. Recheck bindings under lock.
                CompendiumSource::orderBy('id')->lockForUpdate()->get();
                try {
                    foreach ($plan as $binding) {
                        ['entry' => $entry, 'id' => $id, 'sha' => $sha, 'evidence' => $evidence] = $binding;
                        $fresh = CompendiumEntry::whereKey($entry->id)->lockForUpdate()->firstOrFail();
                        if ($fresh->checksum !== $entry->checksum || $fresh->normalized_data !== $entry->normalized_data || $fresh->raw_data !== $entry->raw_data
                            || $fresh->library_user_id !== null || ! app(CompendiumContent::class)->gates($fresh)['browse']) {
                            throw new InvalidArgumentException('Entry changed during installation.');
                        }
                        $asset = $this->asset($sha, $images[$sha], $createdPaths);
                        $attributes = ['asset_id' => $asset->id, 'pack' => self::KEY, 'source_record_id' => $id,
                            'entry_checksum' => $entry->checksum, 'image_sha256' => $sha, 'evidence' => $evidence];
                        $old = CompendiumVisual::find($entry->id);
                        // MySQL canonicalizes JSON object key order; compare semantic values.
                        if ($old && $old->only(array_keys($attributes)) != $attributes) {
                            throw new InvalidArgumentException('Concurrent or changed visual binding.');
                        }
                        if (! $old) {
                            CompendiumVisual::create(['compendium_entry_id' => $entry->id] + $attributes);
                        }
                    }
                } catch (\Throwable $e) {
                    // Clean up while the installation mutex is still held. Another installer
                    // must not reuse these files between rollback and cleanup.
                    Storage::disk('campaigns')->delete($createdPaths);
                    throw $e;
                }
            });
        }

        return ['pack' => self::KEY, 'applied' => $apply, 'counts' => $counts, 'by_type' => $types, 'unlinked_reasons' => $reasons];
    }

    private function identity(CompendiumEntry $entry): ?string
    {
        if ($entry->source->key !== 'srd-2024') {
            return null;
        }
        $id = data_get($entry->normalized_data, 'content.source_id');
        if ($id) {
            return 'srd:'.data_get($entry->raw_data, 'record.stable_version_id') === $id ? $id : null;
        }
        // Legacy SRD API records carry explicit upstream index + URL, never use display names.
        $raw = $entry->raw_data;
        $kind = $entry->entity_type === 'spells' ? 'spell' : (str_contains($raw['url'] ?? '', '/magic-items/') ? 'magic_item' : 'equipment');
        $segment = match ($kind) {
            'spell' => 'spells', 'magic_item' => 'magic-items', default => 'equipment'
        };
        if (($raw['index'] ?? null) !== $entry->external_key || ($raw['url'] ?? null) !== '/api/2024/'.$segment.'/'.$entry->external_key) {
            return null;
        }

        return 'srd:'.$kind.':'.$entry->external_key.':2024';
    }

    private function asset(string $sha, array $image, array &$createdPaths): Asset
    {
        $disk = Storage::disk('campaigns');
        $asset = Asset::where('builtin_key', 'local-visual:'.$sha)->first();
        if ($asset) {
            if (! $disk->exists($asset->storage_path) || hash_file('sha256', $disk->path($asset->storage_path)) !== $sha) {
                throw new InvalidArgumentException('Installed image is missing or modified.');
            }

            return $asset;
        }
        $path = 'local-visual/'.$sha.'.png';
        if ($disk->exists($path)) {
            if (hash_file('sha256', $disk->path($path)) !== $sha) {
                throw new InvalidArgumentException('Conflicting private image.');
            }
        } else {
            $createdPaths[] = $path;
            $bytes = file_get_contents($image['path']);
            if (hash('sha256', $bytes) !== $sha) {
                throw new InvalidArgumentException('Source image changed during installation.');
            }
            $disk->put($path, $bytes);
        }
        $asset = Asset::create(['campaign_id' => null, 'library_user_id' => null, 'uploaded_by' => null,
            'builtin_key' => 'local-visual:'.$sha, 'kind' => 'prop', 'category' => 'art',
            'name' => 'Local Visual · '.substr($sha, 0, 12), 'original_name' => $sha.'.png', 'storage_path' => $path,
            'mime_type' => 'image/png', 'file_size' => filesize($image['path']), 'width' => $image['width'], 'height' => $image['height']]);
        $createdPaths[] = app(AssetThumbnail::class)->path($asset);
        $createdPaths[] = $path.'.thumb.lock';
        app(AssetThumbnail::class)->ensure($asset);

        return $asset;
    }

    public function detach(): int
    {
        return DB::transaction(function () {
            CompendiumSource::orderBy('id')->lockForUpdate()->get();

            // Retain immutable Assets: existing independent snapshots keep their images.
            return CompendiumVisual::where('pack', self::KEY)->delete();
        });
    }
}
