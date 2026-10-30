<?php

namespace App\Http\Middleware;

use App\Support\RequestPerformance;
use Closure;

class PerformanceDispatch
{
    public function handle($request, Closure $next): mixed
    {
        return app(RequestPerformance::class)->measure('dispatch', fn () => $next($request));
    }
}
