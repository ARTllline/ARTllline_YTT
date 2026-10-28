<?php

namespace Tests\Feature;

use Tests\TestCase;

class WorkspaceTest extends TestCase
{
    public function test_login_shell_is_available_without_authentication(): void
    {
        $this->withoutVite();
        config(['database.default' => 'unconfigured', 'session.driver' => 'array']);

        $this->get('/login')
            ->assertOk()
            ->assertViewIs('workspace')
            ->assertSee('YTT · Your Tabletop')
            ->assertSee('Preparing your workspace')
            ->assertSee('id="root"', false);
    }

    public function test_health_endpoint_is_available(): void
    {
        $this->get('/up')->assertOk();
    }
}
