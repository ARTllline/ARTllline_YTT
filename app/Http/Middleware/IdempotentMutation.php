<?php

namespace App\Http\Middleware;

use App\Actions\IdempotentCommand;
use App\Realtime\CommandContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class IdempotentMutation
{
    public function handle(Request $request, Closure $next): Response
    {
        $data = $request->validate(['clientMutationId' => 'sometimes|required|uuid', 'dragSessionId' => 'sometimes|nullable|uuid']);
        $context = app(CommandContext::class);
        $context->mutationId = $data['clientMutationId'] ?? null;
        $context->dragSessionId = $data['dragSessionId'] ?? null;
        $id = $context->id();
        $socket = $request->header('X-Socket-ID');
        $context->socketId = is_string($socket) && preg_match('/^\d+\.\d+$/', $socket) ? $socket : null;
        $parameters = $request->route()->parameters();
        $resource = reset($parameters);

        return app(IdempotentCommand::class)->execute($request->user(), $id, $request->route()->getName(),
            (int) $resource, $request->except(['clientMutationId', '_token']), fn () => $next($request));
    }
}
