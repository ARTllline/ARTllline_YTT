@php
    $status = trim($__env->yieldContent('code'));
    $message = match ($status) {
        '401', '403' => __('ui.denied'),
        '404' => __('ui.missing'),
        '419' => __('ui.expired'),
        default => __('ui.retry'),
    };
@endphp
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>{{ $status }} · {{ __('ui.error') }} · YTT</title>
    <style>
        :root { color-scheme: dark; font: 16px/1.6 'Segoe UI', system-ui, sans-serif; background: #111718; color: #e1e8e4; }
        body { min-height: 100dvh; margin: 0; display: grid; place-items: center; }
        main { max-width: 32rem; padding: 32px; }
        small, a { color: #a6d9c3; } h1 { font-size: 26px; line-height: 1.3; }
        a { display: inline-block; margin-top: 16px; } a:focus-visible { outline: 2px solid #a6d9c3; outline-offset: 4px; }
    </style>
</head>
<body><main><small>YTT / {{ $status }}</small><h1>{{ __('ui.error') }}</h1><p>{{ $message }}</p><a href="/">{{ __('ui.home') }}</a></main></body>
</html>
