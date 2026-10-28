<?php

namespace App\Realtime;

use Illuminate\Support\Str;

/** Request-scoped transport metadata; domain actions also work without HTTP. */
class CommandContext
{
    public ?string $mutationId = null;

    public ?string $socketId = null;

    public ?string $dragSessionId = null;

    public array $triggerChain = [];

    public ?string $correlationId = null;

    public function id(): string
    {
        return $this->mutationId ??= (string) Str::uuid();
    }
}
