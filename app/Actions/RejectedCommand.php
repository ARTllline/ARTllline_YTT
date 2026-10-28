<?php

namespace App\Actions;

use Symfony\Component\HttpFoundation\Response;

class RejectedCommand extends \RuntimeException
{
    public function __construct(public readonly Response $response)
    {
        parent::__construct('Command rejected');
    }
}
