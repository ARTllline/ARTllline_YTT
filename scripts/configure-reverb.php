<?php

// Local setup only. Existing credentials and APP_KEY are preserved.
$path = dirname(__DIR__).'/.env';
$env = file_get_contents($path);
$values = ['BROADCAST_CONNECTION' => 'reverb', 'REVERB_APP_ID' => 'ytt',
    'REVERB_APP_KEY' => bin2hex(random_bytes(16)), 'REVERB_APP_SECRET' => bin2hex(random_bytes(32)),
    'REVERB_HOST' => '127.0.0.1', 'REVERB_PORT' => '8080', 'REVERB_SCHEME' => 'http',
    'REVERB_SERVER_HOST' => '127.0.0.1', 'REVERB_ALLOWED_ORIGINS' => '127.0.0.1,localhost'];
foreach ($values as $key => $value) {
    if (preg_match('/^'.preg_quote($key, '/').'=(.*)$/m', $env)) {
        if ($key === 'BROADCAST_CONNECTION') {
            $env = preg_replace('/^BROADCAST_CONNECTION=.*$/m', 'BROADCAST_CONNECTION=reverb', $env);
        }
    } else {
        $env .= "\n$key=$value";
    }
}
file_put_contents($path, rtrim($env)."\n");
echo "Local Reverb configuration ready; existing credentials preserved.\n";
