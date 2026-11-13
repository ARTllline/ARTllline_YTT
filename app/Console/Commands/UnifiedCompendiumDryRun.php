<?php

namespace App\Console\Commands;

use App\Compendium\Unified\UnifiedDryRun;
use Illuminate\Console\Command;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Throwable;

class UnifiedCompendiumDryRun extends Command
{
    protected $signature = 'compendium:unified-dry-run {root : Unified Library directory} {--manifest= : Explicit checksum-pinned SRD 2024 selection (1–20 records)} {--offline : Validate without querying the catalog; existing IDs and diff remain unknown} {--report= : Write the JSON plan to a new report file}';

    protected $description = 'Validate and compare a small Unified SRD 2024 package; never writes to the database';

    public function handle(UnifiedDryRun $dryRun): int
    {
        try {
            if (! is_string($this->option('manifest')) || $this->option('manifest') === '') {
                throw new InvalidArgumentException('An explicit --manifest is required. There is no bulk/default selection.');
            }
            $report = $dryRun->run($this->argument('root'), $this->option('manifest'), (bool) $this->option('offline'));
            if ($path = $this->option('report')) {
                // Exclusive creation protects source data and previous review artifacts.
                $handle = @fopen($path, 'xb');
                if ($handle === false) {
                    throw new InvalidArgumentException('Report must be a new writable file.');
                }
                try {
                    $json = json_encode($report, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)."\n";
                    if (fwrite($handle, $json) !== strlen($json)) {
                        throw new InvalidArgumentException('Could not write complete report.');
                    }
                } finally {
                    fclose($handle);
                }
            }
            $this->table(['Source ID', 'DB action', 'Gate'], array_map(fn ($r) => [$r['id'], $r['action'] ?? 'conflict', $r['reason'] ?? 'reviewed'], $report['records']));
            $this->line(json_encode(['actions' => $report['actions'], 'plan_checksum' => $report['plan_checksum']], JSON_THROW_ON_ERROR));
            $this->line(json_encode($report['counts'], JSON_THROW_ON_ERROR));
            $this->info('Dry run: no database or asset writes. Live apply remains blocked until schema activation, explicit reviews and separate CONTENT-05 authorization.');
            $this->line('Review ready: '.($report['review_ready'] ? 'yes' : 'no'));

            return $report['validation_passed'] ? self::SUCCESS : self::FAILURE;
        } catch (Throwable $e) {
            $this->error('Unified dry-run failed: '.($e instanceof ValidationException ? json_encode($e->errors(), JSON_UNESCAPED_UNICODE) : $e->getMessage()));

            return self::FAILURE;
        }
    }
}
