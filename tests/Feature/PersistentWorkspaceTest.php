<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CampaignMember;
use App\Models\Scene;
use App\Models\Token;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PersistentWorkspaceTest extends TestCase
{
    use RefreshDatabase;

    private User $gm;

    private User $player;

    private User $stranger;

    private Campaign $campaign;

    private Scene $scene;

    private Scene $secret;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
        $this->gm = User::factory()->create();
        $this->player = User::factory()->create();
        $this->stranger = User::factory()->create();
        $this->campaign = Campaign::create(['name' => 'The Marches']);
        $this->campaign->members()->attach($this->gm, ['role' => 'gm']);
        $this->campaign->members()->attach($this->player, ['role' => 'player']);
        $this->scene = $this->campaign->scenes()->create(['name' => 'Tavern']);
        $this->secret = $this->campaign->scenes()->create(['name' => 'Secret finale']);
        $this->campaign->active_scene_id = $this->scene->id;
        $this->campaign->save();
    }

    private function token(array $data = [], ?Scene $scene = null): Token
    {
        return ($scene ?? $this->scene)->tokens()->create($data + ['name' => 'Goblin', 'x' => 30.125, 'y' => 90.75, 'hp' => 7, 'max_hp' => 12, 'owner_user_id' => $this->player->id]);
    }

    private function asset(string $kind = 'map'): Asset
    {
        return Asset::create(['campaign_id' => $this->campaign->id, 'uploaded_by' => $this->gm->id, 'kind' => $kind,
            'original_name' => 'private-image.png', 'storage_path' => 'campaigns/'.$this->campaign->id.'/'.uniqid().'.png',
            'mime_type' => 'image/png', 'file_size' => 100, 'width' => 100, 'height' => 100]);
    }

    public function test_registration_login_logout_and_guest_access(): void
    {
        $this->get('/')->assertRedirect('/login');
        $this->getJson('/api/campaigns')->assertUnauthorized();
        $this->postJson('/api/register', ['name' => 'New GM', 'email' => 'NEW@example.test', 'password' => 'A-long-password-42', 'password_confirmation' => 'A-long-password-42'])->assertOk()->assertJsonPath('user.email', 'new@example.test');
        $user = User::where('email', 'new@example.test')->firstOrFail();
        $this->assertTrue(Hash::check('A-long-password-42', $user->password));
        $this->getJson('/api/session')->assertJsonPath('user.id', (string) $user->id)->assertJsonMissingPath('user.password');
        $this->postJson('/api/logout')->assertOk();
        $this->assertGuest();
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'incorrect'])->assertUnprocessable();
        $this->postJson('/api/login', ['email' => $user->email, 'password' => 'A-long-password-42'])->assertOk();
        $this->assertAuthenticatedAs($user);
    }

    public function test_csrf_rejects_mutations_without_a_matching_token(): void
    {
        $this->app['env'] = 'local';
        try {
            $this->actingAs($this->gm)->postJson('/api/campaigns', ['name' => 'CSRF'])->assertStatus(419);
        } finally {
            $this->app['env'] = 'testing';
        }
        $this->assertDatabaseMissing('campaigns', ['name' => 'CSRF']);
    }

    public function test_creator_becomes_gm_and_other_members_cannot_modify_campaign(): void
    {
        $id = $this->actingAs($this->gm)->postJson('/api/campaigns', ['name' => 'New world'])->assertOk()->json('id');
        $this->assertDatabaseHas('campaign_members', ['campaign_id' => $id, 'user_id' => $this->gm->id, 'role' => 'gm']);
        $this->actingAs($this->stranger)->getJson('/api/campaigns/'.$this->campaign->id)->assertForbidden();
        $this->actingAs($this->player)->getJson('/api/campaigns/'.$this->campaign->id)->assertOk()->assertJsonMissing(['name' => 'Secret finale'])->assertJsonMissingPath('members');
        $this->patchJson('/api/campaigns/'.$this->campaign->id, ['name' => 'Hacked'])->assertForbidden();
    }

    public function test_scene_create_edit_activate_and_safe_delete(): void
    {
        $id = $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/scenes', ['name' => 'Sewers'])->assertOk()->assertJsonPath('revision', 0)->json('id');
        $this->assertDatabaseHas('scenes', ['id' => $id, 'campaign_id' => $this->campaign->id]);
        $this->getJson('/api/scenes/'.$id.'/snapshot')->assertOk();
        $this->assertSame($this->scene->id, $this->campaign->fresh()->active_scene_id);
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/activate', ['sceneId' => $id])->assertOk()->assertJsonPath('activeSceneId', $id);
        $this->deleteJson('/api/scenes/'.$id)->assertUnprocessable();
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/activate', ['sceneId' => null])->assertOk();
        $this->deleteJson('/api/scenes/'.$id)->assertOk();
        $this->assertDatabaseMissing('scenes', ['id' => $id]);
        $this->actingAs($this->player)->postJson('/api/campaigns/'.$this->campaign->id.'/scenes', ['name' => 'Forbidden'])->assertForbidden();
        $this->patchJson('/api/scenes/'.$this->scene->id, ['name' => 'Forbidden'])->assertForbidden();
    }

    public function test_player_snapshot_omits_hidden_entities_and_gm_metadata_entirely(): void
    {
        $visible = $this->token();
        $hidden = $this->token(['name' => 'Ancient Dragon', 'is_hidden' => true]);
        $this->actingAs($this->player)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()
            ->assertJsonCount(1, 'tokens')->assertJsonPath('tokens.0.id', (string) $visible->id)
            ->assertJsonMissing(['name' => 'Ancient Dragon'])->assertJsonMissingPath('tokens.0.ownerUserId')
            ->assertJsonPath('tokens.0.hp', 7)->assertJsonMissingPath('tokens.0.isHidden');
        $this->getJson('/api/scenes/'.$this->secret->id.'/snapshot')->assertForbidden();
        $this->actingAs($this->gm)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonCount(2, 'tokens')->assertJsonFragment(['id' => (string) $hidden->id, 'isHidden' => true]);
        $this->actingAs($this->stranger)->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertForbidden();
    }

    public function test_player_movement_boundary_and_admin_mass_assignment(): void
    {
        $owned = $this->token();
        $this->actingAs($this->player)->postJson('/api/tokens/'.$owned->id.'/move', ['x' => 123.125, 'y' => -48.75, 'hp' => 999, 'is_hidden' => true])->assertOk()->assertJsonPath('revision', 1)->assertJsonPath('token.hp', 7);
        $this->assertDatabaseHas('tokens', ['id' => $owned->id, 'x' => 123.125, 'y' => -48.75, 'hp' => 7, 'is_hidden' => false]);
        $this->patchJson('/api/tokens/'.$owned->id, ['owner_user_id' => $this->player->id, 'hp' => 999])->assertForbidden();
        foreach ([$this->token(['owner_user_id' => $this->gm->id]), $this->token(['is_hidden' => true]), $this->token(['is_locked' => true]), $this->token([], $this->secret)] as $token) {
            $this->postJson('/api/tokens/'.$token->id.'/move', ['x' => 10, 'y' => 20])->assertForbidden();
        }
        $this->assertSame(1, $this->scene->fresh()->revision);
        $this->actingAs($this->stranger)->postJson('/api/tokens/'.$owned->id.'/move', ['x' => 0, 'y' => 0])->assertForbidden();
    }

    public function test_gm_can_move_hidden_locked_tokens_and_cannot_assign_foreign_relations(): void
    {
        $token = $this->token(['is_hidden' => true, 'is_locked' => true]);
        $this->actingAs($this->gm)->postJson('/api/tokens/'.$token->id.'/move', ['x' => 90, 'y' => 150])->assertOk();
        $this->patchJson('/api/tokens/'.$token->id, ['owner_user_id' => $this->stranger->id])->assertUnprocessable();
        $foreign = Campaign::create(['name' => 'Other']);
        $asset = $this->asset('token');
        $asset->campaign_id = $foreign->id;
        $asset->save();
        $this->patchJson('/api/tokens/'.$token->id, ['token_image_asset_id' => $asset->id])->assertUnprocessable();
        $otherScene = $foreign->scenes()->create(['name' => 'Foreign']);
        $this->postJson('/api/campaigns/'.$this->campaign->id.'/activate', ['sceneId' => $otherScene->id])->assertUnprocessable();
        $this->get('/campaigns/'.$this->campaign->id.'/scenes/'.$otherScene->id)->assertNotFound();
    }

    public function test_every_committed_scene_mutation_advances_revision_and_reloads_exactly(): void
    {
        $this->actingAs($this->gm);
        $id = $this->postJson('/api/scenes/'.$this->scene->id.'/tokens', ['name' => 'Kern', 'x' => 30.125, 'y' => 90.75])->assertOk()->assertJsonPath('revision', 1)->json('token.id');
        $this->patchJson('/api/tokens/'.$id, ['rotation' => 90, 'scale' => 1.3, 'hp' => 6, 'max_hp' => 15, 'is_hidden' => true, 'is_locked' => true, 'owner_user_id' => $this->player->id])->assertOk()->assertJsonPath('revision', 2);
        $this->putJson('/api/scenes/'.$this->scene->id.'/grid', ['size' => 80, 'offset' => ['x' => 10.125, 'y' => -5], 'visible' => false, 'snap' => false])->assertOk()->assertJsonPath('revision', 3);
        $asset = $this->asset();
        $this->putJson('/api/scenes/'.$this->scene->id.'/map', ['assetId' => $asset->id, 'x' => -10, 'y' => 12.5, 'width' => 1000, 'height' => 800])->assertOk()->assertJsonPath('revision', 4);
        $this->patchJson('/api/scenes/'.$this->scene->id, ['name' => 'Renamed'])->assertOk()->assertJsonPath('revision', 5);
        $this->getJson('/api/scenes/'.$this->scene->id.'/snapshot')->assertOk()->assertJsonPath('revision', 5)->assertJsonPath('tokens.0.x', 30.125)->assertJsonPath('tokens.0.rotation', 90)->assertJsonPath('tokens.0.scale', 1.3)->assertJsonPath('tokens.0.hp', 6)->assertJsonPath('tokens.0.isHidden', true)->assertJsonPath('tokens.0.isLocked', true)->assertJsonPath('tokens.0.ownerUserId', (string) $this->player->id)->assertJsonPath('grid.offset.x', 10.125)->assertJsonPath('map.y', 12.5)->assertJsonMissingPath('map.asset.storage_path');
        $this->deleteJson('/api/tokens/'.$id)->assertOk()->assertJsonPath('revision', 6);
        $this->assertDatabaseMissing('tokens', ['id' => $id]);
    }

    public function test_assets_are_private_and_visibility_is_rechecked_on_each_request(): void
    {
        Storage::fake('campaigns');
        $id = $this->actingAs($this->gm)->postJson('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'map', 'file' => UploadedFile::fake()->image('map.png', 100, 100)])->assertOk()->assertJsonMissingPath('storage_path')->json('id');
        $asset = Asset::findOrFail($id);
        Storage::disk('campaigns')->assertExists($asset->storage_path);
        $this->get('/api/assets/'.$id)->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->secret->update(['map_asset_id' => $id]);
        $this->actingAs($this->player)->getJson('/api/assets/'.$id)->assertForbidden();
        $this->scene->update(['map_asset_id' => $id]);
        $this->get('/api/assets/'.$id)->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $this->scene->update(['map_asset_id' => null]);
        $token = $this->token(['token_image_asset_id' => $id]);
        $this->get('/api/assets/'.$id)->assertOk();
        $token->update(['is_hidden' => true]);
        $this->getJson('/api/assets/'.$id)->assertForbidden();
        $this->actingAs($this->stranger)->getJson('/api/assets/'.$id)->assertForbidden();
    }

    public function test_uploads_reject_spoofed_mime_svg_large_images_and_unauthorized_users(): void
    {
        Storage::fake('campaigns');
        $url = '/api/campaigns/'.$this->campaign->id.'/assets';
        $this->actingAs($this->player)->postJson($url, ['kind' => 'map', 'file' => UploadedFile::fake()->image('map.png')])->assertForbidden();
        $this->actingAs($this->gm);
        foreach ([UploadedFile::fake()->createWithContent('evil.png', '<?php echo "not an image";'), UploadedFile::fake()->createWithContent('evil.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'), UploadedFile::fake()->image('too-wide.png', 8193, 1), UploadedFile::fake()->create('big.png', 16385, 'image/png')] as $file) {
            $this->postJson($url, ['kind' => 'map', 'file' => $file])->assertUnprocessable();
        }
        $this->assertDatabaseCount('assets', 0);
    }

    public function test_failed_mutations_do_not_advance_revision_and_scene_delete_cascades_tokens(): void
    {
        $token = $this->token([], $this->secret);
        $this->actingAs($this->gm)->patchJson('/api/tokens/'.$token->id, ['hp' => 10000])->assertUnprocessable();
        $this->assertSame(0, $this->secret->fresh()->revision);
        $this->deleteJson('/api/scenes/'.$this->secret->id)->assertOk();
        $this->assertDatabaseMissing('tokens', ['id' => $token->id]);
        $this->assertSame(2, CampaignMember::where('campaign_id', $this->campaign->id)->count());
    }

    public function test_supported_formats_use_generated_private_paths_regardless_of_client_name(): void
    {
        Storage::fake('campaigns');
        $this->actingAs($this->gm);
        foreach (['png', 'jpg', 'webp'] as $extension) {
            $image = UploadedFile::fake()->image('source.'.$extension, 80, 100);
            $upload = new UploadedFile($image->getRealPath(), '../../secret.php', 'text/html', null, true);
            $id = $this->postJson('/api/campaigns/'.$this->campaign->id.'/assets', ['kind' => 'token', 'file' => $upload])->assertOk()->assertJsonMissingPath('storage_path')->json('id');
            $asset = Asset::findOrFail($id);
            $this->assertMatchesRegularExpression('#^campaigns/'.$this->campaign->id.'/token/[a-f0-9-]+\\.'.$extension.'$#', $asset->storage_path);
            $this->assertStringNotContainsString('..', $asset->storage_path);
            $this->get('/api/assets/'.$id)->assertOk()->assertHeader('Content-Type', $asset->mime_type);
        }
    }

    public function test_membership_is_unique_and_additional_gm_uses_the_same_permissions(): void
    {
        $this->campaign->members()->attach($this->stranger, ['role' => 'gm']);
        $this->actingAs($this->stranger)->patchJson('/api/campaigns/'.$this->campaign->id, ['name' => 'Shared GM workspace'])->assertOk();
        $this->expectException(QueryException::class);
        $this->campaign->members()->attach($this->stranger, ['role' => 'player']);
    }
}
