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
            ->assertSee('YTT · Ваш игровой стол')
            ->assertSee('Подготовка рабочего пространства')
            ->assertSee('lang="ru"', false)
            ->assertSee('id="root"', false);
    }

    public function test_health_endpoint_is_available(): void
    {
        $this->get('/up')->assertOk();
    }

    public function test_session_advertises_browser_reverb_address_without_internal_secrets(): void
    {
        config([
            'session.driver' => 'array',
            'broadcasting.connections.reverb.key' => 'public-key',
            'broadcasting.connections.reverb.secret' => 'private-secret',
            'broadcasting.connections.reverb.options.host' => 'reverb',
            'broadcasting.connections.reverb.options.port' => 8080,
            'broadcasting.connections.reverb.public.host' => 'localhost',
            'broadcasting.connections.reverb.public.port' => 8085,
            'broadcasting.connections.reverb.public.scheme' => 'http',
        ]);

        $this->getJson('/api/session')->assertOk()
            ->assertJsonPath('realtime.host', 'localhost')
            ->assertJsonPath('realtime.port', 8085)
            ->assertJsonPath('realtime.key', 'public-key')
            ->assertDontSee('private-secret')
            ->assertDontSee('"host":"reverb"', false);
    }
}
