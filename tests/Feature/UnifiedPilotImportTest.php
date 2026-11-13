<?php

namespace Tests\Feature;

use App\Compendium\Unified\UnifiedPilotImport;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Tests\TestCase;

class UnifiedPilotImportTest extends TestCase
{
    private function plan(): array
    {
        return ['source' => 'srd-2024', 'ruleset' => 'dnd-2024', 'adapter_version' => 4,
            'review_ready' => true, 'transaction_writer_ready' => true, 'plan_checksum' => str_repeat('a', 64),
            'actions' => ['create' => 0, 'update' => 13, 'skip' => 0, 'conflict' => 0, 'not_compared' => 0],
            'records' => array_map(fn ($id, $entry) => ['id' => $id, 'existing_entry_id' => $entry,
                'gates' => ['browse' => true, 'copy' => true, 'execute' => false]], array_keys(UnifiedPilotImport::ENTRIES), array_values(UnifiedPilotImport::ENTRIES))];
    }

    public function test_exact_plan_and_explicit_no_op_repeat_are_the_only_admitted_actions(): void
    {
        $gate = app(UnifiedPilotImport::class);
        $permit = ['plan_checksum' => str_repeat('a', 64), 'allow_idempotent_repeat' => true];
        $plan = $this->plan();
        $gate->assertPlan($permit, $plan);
        $plan['actions'] = ['create' => 0, 'update' => 0, 'skip' => 13, 'conflict' => 0, 'not_compared' => 0];
        $plan['plan_checksum'] = str_repeat('b', 64);
        $gate->assertPlan($permit, $plan);
        $this->expectException(InvalidArgumentException::class);
        $gate->assertPlan(['plan_checksum' => str_repeat('a', 64), 'allow_idempotent_repeat' => false], $plan);
    }

    public function test_scope_permissions_identity_and_stale_plan_fail_closed(): void
    {
        $valid = $this->plan();
        $variants = [];
        $variants[] = array_replace($valid, ['plan_checksum' => str_repeat('b', 64)]);
        $variants[] = array_replace($valid, ['source' => 'bg3']);
        $variants[] = array_replace($valid, ['ruleset' => 'dnd-2014']);
        $variants[] = array_replace($valid, ['adapter_version' => 3]);
        $variants[] = array_replace($valid, ['transaction_writer_ready' => false]);
        $create = $valid;
        $create['actions']['create'] = 1;
        $create['actions']['update'] = 12;
        $variants[] = $create;
        $mixed = $valid;
        $mixed['actions']['update'] = 12;
        $mixed['actions']['skip'] = 1;
        $variants[] = $mixed;
        $missing = $valid;
        array_pop($missing['records']);
        $variants[] = $missing;
        $wish = $valid;
        $wish['records'][0]['id'] = 'srd:spell:wish:2024';
        $variants[] = $wish;
        $identity = $valid;
        $identity['records'][0]['existing_entry_id'] = 341;
        $variants[] = $identity;
        $execute = $valid;
        $execute['records'][0]['gates']['execute'] = true;
        $variants[] = $execute;
        foreach ($variants as $i => $plan) {
            try {
                app(UnifiedPilotImport::class)->assertPlan(['plan_checksum' => str_repeat('a', 64)], $plan);
                $this->fail('Unsafe pilot variant admitted: '.$i);
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_native_gate_and_cli_refuse_other_environments_before_any_sql(): void
    {
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        $environment = app('env');
        try {
            foreach (['production', 'testing', 'local'] as $env) {
                app()->instance('env', $env);
                try {
                    app(UnifiedPilotImport::class)->authorize('unused', 'unused');
                    $this->fail('Non-local-MySQL context admitted.');
                } catch (InvalidArgumentException $e) {
                    $this->assertStringContainsString('Live writes are disabled', $e->getMessage());
                }
                $this->artisan('compendium:unified-import', ['root' => 'unused', '--manifest' => 'unused', '--apply' => true,
                    '--confirm-plan' => str_repeat('a', 64)])->assertFailed();
            }
        } finally {
            app()->instance('env', $environment);
        }
        $this->assertSame([], $queries);
    }
}
