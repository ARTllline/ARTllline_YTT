<?php

namespace Tests\Feature;

use App\Compendium\Unified\UnifiedBulkImportPermit;
use InvalidArgumentException;
use Tests\TestCase;

class UnifiedBulkImportPermitTest extends TestCase
{
    private function fixture(): array
    {
        $records = [['id' => 'srd:equipment:synthetic:2024', 'existing_entry_id' => 123,
            'identity' => ['source' => 'srd-2024', 'entity_type' => 'items', 'external_key' => 'synthetic'],
            'source_checksum' => str_repeat('1', 64), 'checksum' => str_repeat('2', 64), 'projection_checksum' => str_repeat('3', 64)]];
        $actions = ['create' => 0, 'update' => 1, 'skip' => 0, 'conflict' => 0, 'not_compared' => 0];
        $plan = ['source' => 'srd-2024', 'ruleset' => 'dnd-2024', 'adapter_version' => 5,
            'plan_checksum' => str_repeat('a', 64), 'actions' => $actions, 'validation_passed' => true,
            'review_ready' => true, 'transaction_writer_ready' => true,
            'records' => [array_merge($records[0], ['gates' => ['browse' => true, 'copy' => true, 'execute' => false]])]];
        $permit = ['scope' => 'CONTENT-07B', 'allow_idempotent_repeat' => true,
            'chunk' => ['plan_checksum' => $plan['plan_checksum'], 'actions' => $actions, 'records' => $records]];

        return [$permit, $plan];
    }

    public function test_exact_mixed_or_create_chunk_is_allowed_only_with_its_initial_plan_and_pins(): void
    {
        [$permit, $plan] = $this->fixture();
        $gate = app(UnifiedBulkImportPermit::class);
        $gate->assertPlan($permit, $plan);
        $permit['chunk']['actions'] = $plan['actions'] = ['create' => 1, 'update' => 0, 'skip' => 0, 'conflict' => 0, 'not_compared' => 0];
        $permit['chunk']['records'][0]['existing_entry_id'] = $plan['records'][0]['existing_entry_id'] = null;
        $gate->assertPlan($permit, $plan);
        $this->addToAssertionCount(2);
    }

    public function test_stale_source_plan_identity_permissions_baseline_ids_and_unverified_repeat_fail_closed(): void
    {
        [$permit, $valid] = $this->fixture();
        $variants = [array_replace($valid, ['plan_checksum' => str_repeat('b', 64)]),
            array_replace($valid, ['source' => 'bg3']), array_replace($valid, ['adapter_version' => 4]),
            array_replace($valid, ['review_ready' => false]), array_replace($valid, ['validation_passed' => false])];
        foreach (['id' => 'srd:spell:wish:2024', 'existing_entry_id' => 124, 'projection_checksum' => str_repeat('0', 64),
            'source_checksum' => str_repeat('0', 64), 'gates' => ['browse' => true, 'copy' => true, 'execute' => true]] as $key => $value) {
            $plan = $valid;
            $plan['records'][0][$key] = $value;
            $variants[] = $plan;
        }
        $repeat = $valid;
        $repeat['actions'] = ['create' => 0, 'update' => 0, 'skip' => 1, 'conflict' => 0, 'not_compared' => 0];
        $repeat['plan_checksum'] = str_repeat('b', 64);
        $variants[] = $repeat;
        foreach ($variants as $plan) {
            try {
                app(UnifiedBulkImportPermit::class)->assertPlan($permit, $plan);
                $this->fail('Unapproved bulk mutation/repeat was admitted.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_live_authorization_is_denied_on_sqlite_before_any_queries_or_writes(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('exact local');
        app(UnifiedBulkImportPermit::class)->authorize('unused', 'unused');
    }
}
