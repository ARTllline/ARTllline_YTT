<?php

namespace Tests\Feature;

use Tests\TestCase;

class WorkspaceTest extends TestCase
{
    public function test_workspace_boots_without_database_or_authentication(): void
    {
        $this->withoutVite();
        config(['database.default' => 'unconfigured', 'session.driver' => 'array']);

        $this->get('/')
            ->assertOk()
            ->assertViewIs('workspace')
            ->assertSee('YTT · The Sunken Observatory')
            ->assertSee('Preparing your workspace')
            ->assertSee('id="root"', false);
    }

    public function test_health_endpoint_is_available(): void
    {
        $this->get('/up')->assertOk();
    }
}
