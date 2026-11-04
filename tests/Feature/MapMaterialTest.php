<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\MapMaterialVersion;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class MapMaterialTest extends TestCase
{
    use RefreshDatabase;

    private array $definition;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('campaigns');
        $this->actingAs(User::factory()->create());
        $asset = $this->post('/api/library/assets', ['category' => 'art', 'file' => UploadedFile::fake()->image('stone.png', 96, 48)], ['Accept' => 'application/json'])->assertOk()->json();
        $this->definition = ['name' => 'Stone', 'type' => 'floor', 'assetId' => $asset['id'], 'repeatSize' => 120, 'rotation' => 30, 'variation' => ['offset' => true, 'quarterTurns' => false]];
    }

    private function create(array $patch = []): array
    {
        return $this->postJson('/api/library/materials', array_replace($this->definition, $patch) + ['clientMutationId' => (string) Str::uuid()])->assertOk()->json();
    }

    public function test_personal_materials_version_edit_duplicate_and_keep_old_texture_definition(): void
    {
        $original = $this->create();
        $this->getJson('/api/library/materials?type=floor&search=Stone')->assertOk()->assertJsonPath('materials.0.versionId', $original['versionId']);
        $changed = $this->patchJson('/api/library/materials/'.$original['id'], array_replace($this->definition, ['repeatSize' => 240, 'version' => 1]))->assertOk()->json();
        $this->assertSame(2, $changed['version']);
        $this->assertNotEquals($original['versionId'], $changed['versionId']);
        $this->assertSame(120.0, MapMaterialVersion::findOrFail($original['versionId'])->repeat_size);
        $this->patchJson('/api/library/materials/'.$original['id'], $this->definition + ['version' => 1])->assertConflict();
        $this->postJson('/api/library/materials/'.$original['id'].'/duplicate')->assertOk()->assertJsonPath('version', 1)->assertJsonPath('name', 'Stone · копия');
        $this->getJson('/api/library/materials')->assertJsonCount(2, 'materials');
        $this->deleteJson('/api/assets/'.$this->definition['assetId'])->assertConflict();
        $this->post('/api/library/assets/'.$this->definition['assetId'].'/replace', ['file' => UploadedFile::fake()->image('new.png')], ['Accept' => 'application/json'])->assertConflict();
        $this->assertSame(1, Asset::count());
    }

    public function test_private_access_and_foreign_material_commands_are_denied(): void
    {
        $m = $this->create();
        $this->actingAs(User::factory()->create());
        $this->getJson('/api/library/materials')->assertJsonCount(0, 'materials');
        $this->postJson('/api/library/materials', $this->definition)->assertNotFound();
        $this->patchJson('/api/library/materials/'.$m['id'], $this->definition + ['version' => 1])->assertForbidden();
        $this->postJson('/api/library/materials/'.$m['id'].'/duplicate')->assertForbidden();
        $this->deleteJson('/api/library/materials/'.$m['id'])->assertForbidden();
        $this->get('/api/assets/'.$this->definition['assetId'])->assertForbidden();
        $this->get('/api/assets/'.$this->definition['assetId'].'/thumbnail')->assertForbidden();
    }

    public function test_validation_idempotency_and_delete_restrict_future_version_consumers(): void
    {
        $this->postJson('/api/library/materials', array_replace($this->definition, ['repeatSize' => 0, 'type' => 'shader']))->assertUnprocessable();
        $id = (string) Str::uuid();
        $m = $this->postJson('/api/library/materials', $this->definition + ['clientMutationId' => $id])->assertOk()->json();
        $this->postJson('/api/library/materials', $this->definition + ['clientMutationId' => $id])->assertOk()->assertJsonPath('versionId', $m['versionId']);
        $this->assertSame(1, MapMaterialVersion::count());
        // A synthetic future coverage FK proves the contract without implementing MAP-03.
        Schema::create('material_test_uses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('version_id')->constrained('map_material_versions')->restrictOnDelete();
        });
        try {
            DB::table('material_test_uses')->insert(['version_id' => $m['versionId']]);
            $this->deleteJson('/api/library/materials/'.$m['id'])->assertConflict();
            $this->assertDatabaseHas('map_material_versions', ['id' => $m['versionId']]);
            DB::table('material_test_uses')->delete();
            $this->deleteJson('/api/library/materials/'.$m['id'])->assertOk();
            $this->deleteJson('/api/assets/'.$this->definition['assetId'])->assertOk();
        } finally {
            Schema::dropIfExists('material_test_uses');
        }
    }
}
