<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\Process\Process;

class TabletopDoctor
{
    public function inspect(bool $production = false): array
    {
        $rows = [];
        $check = function (string $name, callable $test) use (&$rows) {
            try {
                [$status, $message] = $test();
            } catch (\Throwable $e) {
                $status = 'ERROR';
                $message = 'Проверка не выполнена ('.class_basename($e).'). Проверьте конфигурацию и доступность службы.';
            }
            $rows[] = compact('name', 'status', 'message');
        };
        $check('PHP', function () {
            $required = ['ctype', 'curl', 'dom', 'fileinfo', 'filter', 'hash', 'mbstring', 'openssl', 'pcre', 'pdo', 'session', 'tokenizer', 'xml', 'gd'];
            $required[] = DB::getDriverName() === 'mysql' ? 'pdo_mysql' : 'pdo_sqlite';
            $missing = array_filter($required, fn ($e) => ! extension_loaded($e));

            return $missing || PHP_VERSION_ID < 80300 || ! function_exists('imagewebp') ? ['ERROR', 'Требуется PHP 8.3+, GD/WebP; отсутствуют: '.implode(', ', $missing)] : ['OK', PHP_VERSION.'; необходимые расширения доступны.'];
        });
        $check('DB', function () {
            DB::select('SELECT 1');

            return ['OK', 'Подключение установлено.'];
        });
        $check('Redis', function () use ($production) {
            try {
                Redis::connection()->ping();

                return ['OK', 'PING получен.'];
            } catch (\Throwable) {
                return [$production || config('cache.default') === 'redis' || config('session.driver') === 'redis' || config('reverb.servers.reverb.scaling.enabled') ? 'ERROR' : 'WARNING', 'Redis недоступен. Для локальной одиночной установки с file cache/session необязателен.'];
            }
        });
        $check('Storage', function () {
            foreach ([storage_path('logs'), storage_path('framework'), base_path('bootstrap/cache')] as $path) {
                if (! is_dir($path) || ! is_writable($path)) {
                    return ['ERROR', 'storage и bootstrap/cache должны быть доступны пользователю PHP для записи.'];
                }
            }

            return ['OK', 'Каталоги приложения доступны для записи.'];
        });
        $check('Private assets', function () {
            $disk = Storage::disk('campaigns');
            $root = realpath($disk->path(''));
            $public = realpath(public_path());
            if (! $root || ! is_writable($root) || str_starts_with(strtolower(str_replace('\\', '/', $root)).'/', strtolower(str_replace('\\', '/', $public)).'/') || config('filesystems.disks.campaigns.serve')) {
                return ['ERROR', 'Приватный диск должен существовать, быть доступным для записи и находиться вне public.'];
            }

            return ['OK', 'Приватный диск вне public. Проверьте отсутствие внешнего Nginx alias.'];
        });
        $check('Queue', function () {
            $c = config('queue.connections.tabletop');
            if ($c['driver'] !== 'database' || ($c['connection'] && $c['connection'] !== config('database.default')) || $c['after_commit'] || $c['retry_after'] <= 60) {
                return ['ERROR', 'Очередь tabletop должна использовать ту же БД, before-commit и retry_after > 60.'];
            }
            DB::table($c['table'])->limit(1)->get(['id']);
            $overdue = DB::table('cue_runs')->whereIn('status', ['queued', 'running'])->where('due_at', '<', now()->subSeconds(90))->exists();

            return [$overdue ? 'WARNING' : 'OK', $overdue ? 'Есть просроченные события. Проверьте worker и recover-cues.' : 'Таблица очереди доступна; запуск worker проверяется отдельным smoke test.'];
        });
        $check('Reverb', function () use ($production) {
            $app = config('reverb.apps.apps.0');
            if (config('broadcasting.default') !== 'reverb' || ! $app['key'] || ! $app['secret'] || ! $app['app_id'] || ! $app['options']['host'] || $app['accept_client_events_from'] !== 'none') {
                return ['ERROR', 'Настройте broadcaster, credentials, host и запрет client events.'];
            }
            if ($production && ($app['options']['scheme'] !== 'https' || in_array('*', $app['allowed_origins']) || ! in_array(parse_url(config('app.url'), PHP_URL_HOST), $app['allowed_origins']))) {
                return ['ERROR', 'Для production нужны WSS и точный hostname приложения в allowed origins.'];
            }

            return ['OK', 'Конфигурация заполнена. WSS/Upgrade/публикацию проверяйте через внешний браузер.'];
        });
        $check('FFprobe', function () {
            $p = new Process([config('media.ffprobe'), '-version']);
            $p->setTimeout(10);
            $p->mustRun();
            preg_match('/ffprobe version ([^\s]+)/', $p->getOutput(), $m);
            $version = $m[1] ?? 'unknown';

            return [preg_match('/^n?([5-9]|[1-9][0-9])\./', $version) ? 'OK' : 'WARNING', 'FFprobe '.$version.'. Проверенный диапазон: 5+; установите обновляемый пакет ОС.'];
        });
        $check('Scheduler', function () {
            $last = Cache::get('tabletop:scheduler-heartbeat');

            return [$last && time() - $last < 150 ? 'OK' : 'WARNING', $last && time() - $last < 150 ? 'Heartbeat моложе 150 секунд.' : 'Нет свежего heartbeat. Включите systemd timer и подождите минуту.'];
        });
        $check('Upload limits (CLI)', fn () => self::bytes(ini_get('upload_max_filesize')) >= 64 * 1024 ** 2 && self::bytes(ini_get('post_max_size')) >= 68 * 1024 ** 2 ? ['OK', 'CLI: 64/68 MiB или выше; отдельно проверьте PHP-FPM и Nginx.'] : ['WARNING', 'Рекомендуется upload_max_filesize=64M, post_max_size=68M; PHP-FPM имеет отдельный ini.']);
        $check('Application', function () use ($production) {
            if (! config('app.key')) {
                return ['ERROR', 'APP_KEY отсутствует. Для новой установки выполните key:generate.'];
            }
            if ($production && (config('app.debug') || ! str_starts_with(config('app.url'), 'https://') || ! config('session.secure'))) {
                return ['ERROR', 'Production: APP_DEBUG=false, APP_URL=https://…, SESSION_SECURE_COOKIE=true.'];
            }

            return ['OK', 'Ключ установлен; секреты в отчёт не выводятся.'];
        });

        return $rows;
    }

    public static function bytes(string $value): int
    {
        $value = trim($value);

        return (int) ((float) $value * match (strtolower(substr($value, -1))) {
            'g' => 1024 ** 3, 'm' => 1024 ** 2, 'k' => 1024, default => 1
        });
    }
}
