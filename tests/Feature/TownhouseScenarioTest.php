<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\Scene;
use App\Models\User;
use App\QA\TownhouseScenario;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class TownhouseScenarioTest extends TestCase
{
    use DatabaseMigrations;

    public function test_reset_without_manifest_requires_explicit_install_and_does_not_change_scene(): void
    {
        Storage::fake('campaigns');
        $gm = User::factory()->create();
        $campaign = Campaign::create(['name' => 'Prepared data']);
        $campaign->members()->attach($gm, ['role' => 'gm']);
        $scene = $campaign->scenes()->create(['name' => 'Preserve until install']);
        try {
            app(TownhouseScenario::class)->run($campaign->id, $scene->id, $gm->id, 5, 6, false);
            $this->fail('An explicit initial replacement is required.');
        } catch (HttpException $e) {
            $this->assertSame(422, $e->getStatusCode());
        }
        $this->assertSame('Preserve until install', $scene->fresh()->name);
        $this->assertSame(1, Scene::count());
        $this->assertSame([], Storage::disk('campaigns')->allFiles());
    }

    public function test_recipe_is_unavailable_in_production_even_with_install(): void
    {
        $this->app->instance('env', 'production');
        try {
            app(TownhouseScenario::class)->run(5, 5, 1, 5, 6, true);
            $this->fail('Production must reject the recipe.');
        } catch (HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
            $this->assertSame('QA recipe is local/testing only.', $e->getMessage());
        } finally {
            $this->app->instance('env', 'testing');
        }
    }
}
