<?php

namespace App\Console\Commands;

use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedImport;
use App\Compendium\Unified\UnifiedPilotImport;
use Illuminate\Console\Command;
use Throwable;

class ImportUnifiedCompendium extends Command
{
    protected $signature = 'compendium:unified-import {root} {--manifest=} {--apply : Exact local approved scope only; separate owner authorization required} {--confirm-plan= : Checksum of the reviewed live plan}';

    protected $description = 'Preview content or apply only a separately authorized exact local CONTENT-05/07B scope';

    public function handle(UnifiedDryRun $plans): int
    {
        if (! is_string($this->option('manifest')) || $this->option('manifest') === '') {
            $this->error('An explicit --manifest is required.');

            return self::FAILURE;
        }
        try {
            if ($this->option('apply')) {
                app(UnifiedPilotImport::class)->authorize($this->argument('root'), $this->option('manifest'));
                $result = app(UnifiedImport::class)->apply($this->argument('root'), $this->option('manifest'), (string) $this->option('confirm-plan'));
                $this->line(json_encode($result, JSON_THROW_ON_ERROR));

                return self::SUCCESS;
            }
            $plan = $plans->run($this->argument('root'), $this->option('manifest'));
            $this->line(json_encode(['actions' => $plan['actions'], 'plan_checksum' => $plan['plan_checksum'], 'review_ready' => $plan['review_ready'], 'database_writes' => 0], JSON_THROW_ON_ERROR));
            $this->info('Preview only. Live apply requires a separate exact local owner permit bound to the reviewed plan and recovery set.');

            return $plan['validation_passed'] ? self::SUCCESS : self::FAILURE;
        } catch (Throwable $e) {
            $this->error('Import preview failed: '.$e->getMessage());

            return self::FAILURE;
        }
    }
}
