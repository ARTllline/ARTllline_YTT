<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#111718">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="description" content="{{ __('ui.description') }}">
    <title>{{ __('ui.title') }}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <style>html,body{margin:0;background:#111718;color:#e8ece9;font-family:system-ui}.boot{height:100dvh;display:grid;place-content:center;text-align:center;gap:12px}.boot small{color:#95a5a2}</style>
    @viteReactRefresh
    @vite('resources/js/app.tsx')
</head>
<body>
    <div id="root"><div class="boot"><strong>{{ __('ui.brand') }}</strong><small>{{ __('ui.loading') }}</small></div></div>
    <noscript>{{ __('ui.javascript') }}</noscript>
</body>
</html>
