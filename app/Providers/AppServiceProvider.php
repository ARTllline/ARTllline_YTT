<?php

namespace App\Providers;

use App\Realtime\CommandContext;
use App\Services\CharacterCatalog;
use App\Spells\SpellEffects;
use App\Support\RequestPerformance;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->scoped(RequestPerformance::class);
        $this->app->scoped(CommandContext::class);
        $this->app->scoped(CharacterCatalog::class);
        $this->app->scoped(SpellEffects::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        if ($this->app->environment('local')) {
            DB::listen(fn ($event) => app(RequestPerformance::class)->query($event));
            foreach (['TransactionBeginning' => 'begin', 'TransactionCommitting' => 'committing', 'TransactionCommitted' => 'committed'] as $event => $phase) {
                Event::listen('Illuminate\\Database\\Events\\'.$event, fn ($e) => app(RequestPerformance::class)->transaction($phase, $e->connection->transactionLevel()));
            }
        }
        RateLimiter::for('spatial', fn ($request) => Limit::perSecond($request->input('kind') === 'ping' ? 4 : 20)->by($request->user()->id.($request->input('kind') === 'ping' ? ':ping' : ':spatial')));
        RateLimiter::for('preview', fn ($request) => Limit::perSecond(20)->by($request->user()->id));
    }
}
