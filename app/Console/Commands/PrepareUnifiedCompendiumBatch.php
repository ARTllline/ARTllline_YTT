<?php

namespace App\Console\Commands;

use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedPilotImport;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class PrepareUnifiedCompendiumBatch extends Command
{
    protected $signature = 'compendium:unified-prepare-batch {root} {--output= : New report/manifests directory} {--equipment=60} {--magic-items=40} {--spells=60} {--offline : No catalog/database checks} {--all : Screen the complete remaining SRD 2024 selection} {--reuse-review= : Reuse pinned previous screening and selection}';

    protected $description = 'Screen a diverse 100–200 record SRD 2024 batch; no approvals, database writes or imports';

    public function handle(UnifiedBatchPreparation $preparation): int
    {
        try {
            if (! is_string($this->option('output')) || $this->option('output') === '') {
                throw new \InvalidArgumentException('Explicit new --output directory required.');
            }
            $quotas = [];
            foreach (['equipment' => 'equipment', 'magic_item' => 'magic-items', 'spell' => 'spells'] as $kind => $option) {
                if (! ctype_digit((string) $this->option($option)) || (int) $this->option($option) > 200) {
                    throw new \InvalidArgumentException('Explicit quotas must be integers between 0 and 200.');
                }
                $quotas[$kind] = (int) $this->option($option);
            }
            if (! $this->option('all') && (array_sum($quotas) < 100 || array_sum($quotas) > 200)) {
                throw new \InvalidArgumentException('Batch selection must contain 100–200 records.');
            }
            if (! $this->option('offline')) {
                DB::connection()->beforeExecuting(function ($sql) {
                    if (! preg_match('/^select\s/i', ltrim($sql))) {
                        throw new \RuntimeException('Read-only batch preparation refuses non-SELECT SQL.');
                    }
                });
            }
            $excluded = [...array_keys(UnifiedPilotImport::ENTRIES), 'srd:magic_item:bag-of-holding:2024', 'srd:spell:wish:2024'];
            $bundle = $preparation->prepare($this->argument('root'), $this->option('output'), $excluded, (bool) $this->option('offline'), $quotas, (bool) $this->option('all'), $this->option('reuse-review'));
            $this->line(json_encode(array_intersect_key($bundle, array_flip(['selected', 'remaining', 'counts', 'human_approvals', 'execute', 'bundle_checksum'])), JSON_THROW_ON_ERROR));
            $this->info('Machine screening only. All semantics pending. Live importer remains separately locked.');

            return self::SUCCESS;
        } catch (Throwable $e) {
            $this->error('Batch preparation stopped: '.$e->getMessage());

            return self::FAILURE;
        }
    }
}
