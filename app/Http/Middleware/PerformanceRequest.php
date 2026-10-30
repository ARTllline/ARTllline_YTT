<?php

namespace App\Http\Middleware;

use App\Support\RequestPerformance;
use Closure;
use GuzzleHttp\TransferStats;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class PerformanceRequest
{
    public function handle(Request $request, Closure $next): mixed
    {
        $trace = app(RequestPerformance::class);
        $trace->enabled = app()->environment('local') && in_array($request->ip(), ['127.0.0.1', '::1']) && $request->header('X-YTT-Perf') === '1';
        if (! $trace->enabled) {
            return $next($request);
        }
        $start = microtime(true);
        $id = $request->input('clientMutationId');
        $id = is_string($id) && Str::isUuid($id) ? $id : (string) Str::uuid();
        config(['broadcasting.connections.reverb.client_options.on_stats' => function (TransferStats $stats) use ($trace) {
            $trace->transfers[] = array_intersect_key($stats->getHandlerStats(), array_flip(['total_time', 'namelookup_time', 'connect_time', 'starttransfer_time', 'size_upload', 'size_download', 'http_code']));
        }]);
        $response = $next($request);
        $total = (microtime(true) - (defined('LARAVEL_START') ? LARAVEL_START : $start)) * 1000;
        $sqlMs = array_sum(array_column($trace->queries, 'ms'));
        $metrics = ['app' => $total, 'bootstrap' => ($start - (defined('LARAVEL_START') ? LARAVEL_START : $start)) * 1000, 'sql' => $sqlMs] + $trace->spans;
        $response->headers->set('Server-Timing', implode(', ', array_map(fn ($k, $v) => $k.';dur='.round($v, 3), array_keys($metrics), $metrics)));
        $response->headers->set('X-YTT-Request-ID', $id);
        $row = ['id' => $id, 'route' => $request->route()?->getName() ?? $request->path(), 'status' => $response->getStatusCode(), 'metrics' => $metrics,
            'queryCount' => array_sum(array_column($trace->queries, 'count')), 'queries' => array_values($trace->queries), 'transactions' => $trace->transactions,
            'broadcasts' => $trace->broadcasts, 'transfers' => $trace->transfers, 'bytes' => strlen($response->getContent())];
        file_put_contents(storage_path('logs/performance.jsonl'), json_encode($row, JSON_THROW_ON_ERROR).PHP_EOL, FILE_APPEND | LOCK_EX);

        return $response;
    }
}
