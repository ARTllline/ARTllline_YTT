<?php

namespace App\Console\Commands;

use App\Compendium\LocalVisualPack;
use Illuminate\Console\Command;

class InstallLocalVisualPack extends Command
{
    protected $signature = 'compendium:visual-pack {root? : Local Unified-DnD-Library directory} {--apply : Install validated bindings} {--detach : Remove bindings, retaining Assets used by copies}';

    protected $description = 'Validate/install an optional local visual pack without importing content or changing existing copies';

    public function handle(LocalVisualPack $pack): int
    {
        try {
            if ($this->option('detach')) {
                if ($this->argument('root')) {
                    throw new \InvalidArgumentException('Detach does not accept a source root.');
                }
                $result = $this->option('apply') ? ['detached' => $pack->detach()] : ['detach_requires_apply' => true];
            } else {
                if (! $this->argument('root')) {
                    throw new \InvalidArgumentException('A local Unified Library directory is required.');
                }
                $result = $pack->run($this->argument('root'), $this->option('apply'));
            }
            $this->line(json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));

            return self::SUCCESS;
        } catch (\Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
    }
}
