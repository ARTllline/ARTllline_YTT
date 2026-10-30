<?php

namespace App\Console\Commands;

use App\Compendium\CompendiumSync;
use App\Compendium\SrdApi;
use App\Models\CompendiumSource;
use Illuminate\Console\Command;
use Throwable;

class SyncCompendium extends Command
{
    protected $signature = 'compendium:sync {source=srd-2024} {--type=*} {--force} {--dry-run} {--snapshot= : Read a previously exported JSON snapshot instead of HTTP} {--export= : Save fetched records for reproducible offline imports}';

    protected $description = 'Import versioned SRD definitions locally; never modifies campaign copies';

    public function handle(CompendiumSync $sync, SrdApi $api): int
    {
        try {
            $source = CompendiumSource::where('key', $this->argument('source'))->firstOrFail();
            if ($source->key !== 'srd-2024') {
                throw new \InvalidArgumentException('No adapter registered for this source.');
            }
            $types = $sync->types($this->option('type'));
            if ($path = $this->option('snapshot')) {
                $snapshot = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
                if (($snapshot['source'] ?? null) !== $source->key || ($snapshot['format'] ?? null) !== 1 || array_diff($sync->endpoints($types), $snapshot['endpoints'] ?? [])) {
                    throw new \InvalidArgumentException('Snapshot source/format/endpoint coverage does not match the request.');
                }
                $records = $snapshot['records'];
                foreach ($sync->endpoints($types) as $endpoint) {
                    if (! collect($records)->contains('endpoint', $endpoint)) {
                        throw new \InvalidArgumentException('Empty snapshot endpoint: '.$endpoint);
                    }
                }
            } else {
                $endpoint = null;
                $records = $api->fetch($sync->endpoints($types), function ($name) use (&$endpoint) {
                    if ($endpoint !== $name) {
                        $this->line('Fetched '.$name.' …');
                    }
                    $endpoint = $name;
                });
            }
            if ($path = $this->option('export')) {
                if (file_put_contents($path, json_encode(['format' => 1, 'source' => $source->key, 'fetched_at' => now()->toIso8601String(), 'endpoints' => $sync->endpoints($types), 'records' => $records], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)) === false) {
                    throw new \RuntimeException('Could not write snapshot.');
                }
            }
            $counts = $sync->import($source, $records, $types, (bool) $this->option('dry-run'), (bool) $this->option('force'));
            $this->table(['Type', 'Created', 'Updated', 'Unchanged'], array_map(fn ($type, $c) => [$type, ...array_values($c)], array_keys($counts), $counts));
            if ($this->option('dry-run')) {
                $this->info('Dry run: no database writes.');
            }

            return self::SUCCESS;
        } catch (Throwable $e) {
            $this->error('Compendium sync failed: '.$e->getMessage());

            return self::FAILURE;
        }
    }
}
