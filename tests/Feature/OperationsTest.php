<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\Cue;
use App\Models\CueRun;
use App\Models\User;
use App\Services\TabletopDoctor;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class OperationsTest extends TestCase
{
    use DatabaseMigrations;

    public function test_doctor_reports_missing_dependencies_without_secrets_and_fails_exit_status(): void
    {
        Storage::fake('campaigns');
        Cache::put('tabletop:scheduler-heartbeat', time(), 300);
        config(['media.ffprobe' => '/missing/ffprobe', 'app.key' => 'SECRET_MUST_NOT_BE_PRINTED', 'app.debug' => true]);
        $rows = app(TabletopDoctor::class)->inspect(true);
        $byName = collect($rows)->keyBy('name');
        $this->assertSame('OK', $byName['DB']['status']);
        $this->assertSame('OK', $byName['Scheduler']['status']);
        $this->assertSame('ERROR', $byName['FFprobe']['status']);
        $this->assertSame('ERROR', $byName['Application']['status']);
        $this->assertStringNotContainsString('SECRET_MUST_NOT_BE_PRINTED', json_encode($rows));
        $this->artisan('tabletop:doctor --production --json')->assertFailed();
        $this->assertSame(67108864, TabletopDoctor::bytes('64M'));
    }

    public function test_execution_retention_keeps_failed_busy_and_recent_runs_and_definitions(): void
    {
        $user = User::factory()->create();
        $c = Campaign::create(['name' => 'Retention']);
        $s = $c->scenes()->create(['name' => 'Table']);
        $cue = Cue::create(['scene_id' => $s->id, 'name' => 'Definition']);
        $make = function ($status, $old) use ($c, $s, $cue, $user) {
            $id = (string) Str::uuid();
            DB::table('cue_runs')->insert(['id' => $id, 'campaign_id' => $c->id, 'scene_id' => $s->id, 'cue_id' => $cue->id, 'created_by' => $user->id, 'epoch' => 1, 'name' => 'Technical', 'status' => $status, 'created_at' => now()->subDays($old ? 120 : 1), 'updated_at' => now()->subDays($old ? 120 : 1)]);

            return $id;
        };
        $old = $make('completed', true);
        $recent = $make('completed', false);
        $failed = $make('failed', true);
        $this->artisan('tabletop:prune-executions')->assertSuccessful();
        $this->assertDatabaseHas('cue_runs', ['id' => $old]);
        CueRun::find($failed)->update(['status' => 'cancelled']);
        $this->artisan('tabletop:prune-executions --dry-run')->assertSuccessful();
        $this->assertDatabaseHas('cue_runs', ['id' => $old]);
        $this->artisan('tabletop:prune-executions')->assertSuccessful();
        $this->assertDatabaseMissing('cue_runs', ['id' => $old]);
        $this->assertDatabaseHas('cue_runs', ['id' => $recent]);
        $this->assertDatabaseHas('cue_runs', ['id' => $failed]);
        $this->assertDatabaseHas('cues', ['id' => $cue->id]);
    }
}
