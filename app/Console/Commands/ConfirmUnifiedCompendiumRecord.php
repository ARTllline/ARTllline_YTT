<?php

namespace App\Console\Commands;

use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedPackage;
use App\Compendium\Unified\UnifiedReview;
use Illuminate\Console\Command;
use InvalidArgumentException;
use Throwable;

class ConfirmUnifiedCompendiumRecord extends Command
{
    protected $signature = 'compendium:unified-confirm {root} {--manifest=} {--id=} {--checksum=} {--projection-checksum=} {--reviewer=} {--evidence=} {--languages=} {--copy : Explicitly approve copying this record} {--execute : Separately approve the existing supported YTT execution profile} {--execution-checksum= : Explicit reviewed profile checksum, required with execute} {--confirm : Human confirmation after reviewing both languages and projection} {--output= : New single-record manifest, never overwrites an existing file}';

    protected $description = 'Record an explicit human decision for one checksum and both languages; never imports';

    public function handle(UnifiedDryRun $plans, UnifiedPackage $packages): int
    {
        try {
            foreach (['manifest', 'id', 'checksum', 'projection-checksum', 'reviewer', 'evidence', 'languages', 'output'] as $option) {
                if (! is_string($this->option($option)) || trim($this->option($option)) === '') {
                    throw new InvalidArgumentException('Explicit --'.$option.' required.');
                }
            }
            if (! $this->option('confirm') || $this->option('languages') !== 'en,ru') {
                throw new InvalidArgumentException('Explicit --confirm --languages=en,ru required. No automatic approval.');
            }
            $root = $this->argument('root');
            $manifest = $packages->read($root, $this->option('manifest'))['manifest'];
            $plan = $plans->run($root, $this->option('manifest'), true);
            $row = collect($plan['records'])->firstWhere('id', $this->option('id'));
            if (! $row || ($row['checksum'] ?? null) !== $this->option('checksum') || ($row['projection_checksum'] ?? null) !== $this->option('projection-checksum')) {
                throw new InvalidArgumentException('Record missing/invalid or checksum/projection changed.');
            }
            if ($this->option('execute') && (! $this->option('copy') || ! data_get($row, 'normalized.content.execution.supported')
                || data_get($row, 'normalized.content.execution.checksum') !== $this->option('execution-checksum'))) {
                throw new InvalidArgumentException('Execution needs explicit copy permission and the exact supported profile checksum. MANUAL profiles cannot be automated.');
            }
            $manifest['selection'] = array_values(array_filter($manifest['selection'], fn ($r) => $r['id'] === $row['id']));
            if (isset($manifest['baseline_reviews'])) {
                $manifest['baseline_reviews'] = array_values(array_filter($manifest['baseline_reviews'], fn ($r) => $r['id'] === $row['id']));
            }
            $manifest['reviews'] = [UnifiedReview::humanDecision($row['id'], $row['checksum'], $row['projection_checksum'],
                $this->option('reviewer'), $this->option('evidence'), (bool) $this->option('copy'),
                (bool) $this->option('execute'), $this->option('execution-checksum'))];
            // Revalidate the decision fields before creating the review artifact.
            if (mb_strlen($manifest['reviews'][0]['reviewer']) > 160 || mb_strlen($manifest['reviews'][0]['evidence']) > 2000) {
                throw new InvalidArgumentException('Reviewer/evidence too long.');
            }
            $handle = @fopen($this->option('output'), 'xb');
            if ($handle === false) {
                throw new InvalidArgumentException('Output must be a new writable file.');
            }
            try {
                $bytes = json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
                if (fwrite($handle, $bytes) !== strlen($bytes)) {
                    throw new InvalidArgumentException('Could not write complete confirmation.');
                }
            } finally {
                fclose($handle);
            }
            $this->info('Single-record human confirmation saved. Database writes: 0. Execution approved: '.($this->option('execute') ? 'explicit supported profile only' : 'no'));

            return self::SUCCESS;
        } catch (Throwable $e) {
            $this->error('Confirmation refused: '.$e->getMessage());

            return self::FAILURE;
        }
    }
}
