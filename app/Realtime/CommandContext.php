<?php

namespace App\Realtime;

use Illuminate\Support\Str;

/** Request-scoped transport metadata; domain actions also work without HTTP. */
class CommandContext
{
    public ?string $mutationId = null;

    public ?string $socketId = null;

    public ?string $dragSessionId = null;

    public function id(): string
    {
        return $this->mutationId ??= (string) Str::uuid();
    }
}
