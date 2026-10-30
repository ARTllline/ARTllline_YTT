<?php

namespace App\Support;

use Closure;
use Illuminate\Database\Events\QueryExecuted;

/** Opt-in local diagnostics. Never stores bindings, users, payloads, URLs or credentials. */
class RequestPerformance
{
    public bool $enabled = false;

    public array $spans = [];

    public array $queries = [];

    public array $broadcasts = [];

    public array $transfers = [];

    public array $transactions = [];

    private ?float $transactionStart = null;

    private ?float $commitStart = null;

    public function measure(string $name, Closure $operation): mixed
    {
        if (! $this->enabled) {
            return $operation();
        }
        $start = microtime(true);
        try {
            return $operation();
        } finally {
            $this->spans[$name] = ($this->spans[$name] ?? 0) + (microtime(true) - $start) * 1000;
        }
    }

    public function query(QueryExecuted $event): void
    {
        if (! $this->enabled) {
            return;
        }
        $sql = preg_replace(["/'(?:''|[^'])*'/", '/\s+/'], ['?', ' '], $event->sql);
        $entry = $this->queries[$sql] ?? ['sql' => $sql, 'count' => 0, 'ms' => 0, 'maxMs' => 0];
        $entry['count']++;
        $entry['ms'] += $event->time;
        $entry['maxMs'] = max($entry['maxMs'], $event->time);
        $this->queries[$sql] = $entry;
    }

    public function transaction(string $phase, int $level): void
    {
        if (! $this->enabled) {
            return;
        }
        if ($phase === 'begin' && $level === 1) {
            $this->transactionStart = microtime(true);
        }
        if ($phase === 'committing' && $level === 1) {
            $this->commitStart = microtime(true);
            if ($this->transactionStart) {
                $this->transactions[] = ['openMs' => ($this->commitStart - $this->transactionStart) * 1000];
            }
        }
        if ($phase === 'committed' && $level === 0 && $this->commitStart) {
            $this->spans['commit_callbacks'] = ($this->spans['commit_callbacks'] ?? 0) + (microtime(true) - $this->commitStart) * 1000;
            $this->commitStart = $this->transactionStart = null;
        }
    }
}
