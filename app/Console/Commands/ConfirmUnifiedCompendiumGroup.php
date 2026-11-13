<?php

namespace App\Console\Commands;

use App\Compendium\Unified\UnifiedBatchPreparation;
use App\Compendium\Unified\UnifiedDryRun;
use App\Compendium\Unified\UnifiedJson;
use App\Compendium\Unified\UnifiedReview;
use Illuminate\Console\Command;
use InvalidArgumentException;
use Throwable;

class ConfirmUnifiedCompendiumGroup extends Command
{
    protected $signature = 'compendium:unified-confirm-group {root} {--review=} {--bundle-checksum=} {--group= : Exact candidate group or comma-separated groups} {--reviewer=} {--evidence=} {--languages=} {--copy} {--confirm} {--accept-legacy-baselines : Separate explicit approval of all listed legacy ID/digest pairs} {--output= : New directory for the exact reviewed subset}';

    protected $description = 'Record one explicit human EN/RU decision for an exact candidate group; execute=false, never imports';

    public function handle(UnifiedJson $json, UnifiedDryRun $plans, UnifiedBatchPreparation $files): int
    {
        try {
            foreach (['review', 'bundle-checksum', 'group', 'reviewer', 'evidence', 'output'] as $key) {
                if (! is_string($this->option($key)) || trim($this->option($key)) === '') {
                    throw new InvalidArgumentException('Explicit --'.$key.' required.');
                }
            }
            if (! $this->option('confirm') || ! $this->option('copy') || $this->option('languages') !== 'en,ru'
                || mb_strlen($this->option('reviewer')) > 160 || mb_strlen($this->option('evidence')) > 1200) {
                throw new InvalidArgumentException('Explicit human --confirm --copy --languages=en,ru and bounded reviewer/evidence required.');
            }
            $bundle = $json->read($this->option('review'), limit: 67108864);
            $digest = $bundle['bundle_checksum'] ?? null;
            unset($bundle['bundle_checksum']);
            if ($digest !== $this->option('bundle-checksum') || $digest !== UnifiedReview::digest($bundle) || ($bundle['human_approvals'] ?? null) !== 0) {
                throw new InvalidArgumentException('Review bundle changed or is not an unapproved snapshot.');
            }
            $group = $this->option('group');
            $groups = explode(',', $group);
            if (count(array_unique($groups)) !== count($groups) || array_diff($groups, array_keys($bundle['groups']))) {
                throw new InvalidArgumentException('Unknown or duplicate explicit group.');
            }
            $selectedIds = array_merge(...array_map(fn ($g) => $bundle['groups'][$g], $groups));
            $ids = array_values(array_filter(array_column($bundle['records'], 'id'), fn ($id) => in_array($id, $selectedIds, true)));
            $members = array_values(array_filter($bundle['records'], fn ($r) => in_array($r['id'], $ids, true)));
            if (! $ids || count($ids) !== count($selectedIds) || array_column($members, 'id') !== $ids || count(array_unique($selectedIds)) !== count($selectedIds)) {
                throw new InvalidArgumentException('Group membership is missing or ambiguous.');
            }
            foreach ($members as $member) {
                if ($member['quality']['status'] !== 'validated_candidate' || $member['proposed_permissions'] !== ['browse' => true, 'copy' => true, 'execute' => false]) {
                    throw new InvalidArgumentException('Only machine-screened candidates may use group confirmation; disputed/rejected records require separate review.');
                }
                if ($member['baseline_proposal'] && ! $this->option('accept-legacy-baselines')) {
                    throw new InvalidArgumentException('Separate --accept-legacy-baselines required for the listed exact ID/digest pairs.');
                }
            }
            $base = dirname($this->option('review'));
            $fresh = $manifests = [];
            // Revalidate every group member before recording any decision or output.
            foreach (array_unique(array_column($members, 'manifest')) as $file) {
                $path = $json->inside($base, $file);
                $chunk = collect($bundle['chunks'])->firstWhere('manifest', $file);
                if (! $chunk || hash_file('sha256', $path) !== $chunk['sha256']) {
                    throw new InvalidArgumentException('Selection manifest changed.');
                }
                $manifests[$file] = $json->read($path);
                $plan = $plans->run($this->argument('root'), $path, $bundle['mode'] === 'offline-screening');
                foreach ($plan['records'] as $row) {
                    $fresh[$row['id']] = $row;
                }
            }
            foreach ($members as $member) {
                $row = $fresh[$member['id']] ?? [];
                foreach (['source_checksum', 'checksum', 'projection_checksum', 'existing_entry_id', 'baseline'] as $key) {
                    if (($row[$key] ?? null) !== ($member['plan'][$key] ?? null)) {
                        throw new InvalidArgumentException('Group source/projection/baseline changed; no decisions recorded.');
                    }
                }
                if (isset($row['errors'])) {
                    throw new InvalidArgumentException('Fresh adapter validation failed.');
                }
            }
            $output = $this->option('output');
            if (file_exists($output) || ! mkdir($output, 0755, true)) {
                throw new InvalidArgumentException('Output must be a new directory.');
            }
            $confirmed = [];
            foreach ($members as $i => $member) {
                $manifest = $manifests[$member['manifest']];
                $manifest['selection'] = [$member['selection']];
                $manifest['reviews'] = [];
                $manifest['baseline_reviews'] = [];
                if ($member['baseline_proposal']) {
                    $b = $member['baseline_proposal'];
                    $b['confirmed'] = true;
                    $b['confirmed_at'] = now()->toIso8601String();
                    $b['reviewer'] = $this->option('reviewer');
                    $b['evidence'] = $this->option('evidence').' Group '.$group.'; snapshot '.$digest.'; explicit baseline approval.';
                    $manifest['baseline_reviews'][] = $b;
                }
                // All members have already passed fresh source/projection/baseline checks.
                // Share the single-record receipt contract instead of reparsing the full
                // export twice for each of hundreds of separately consented members.
                $manifest['reviews'] = [UnifiedReview::humanDecision($member['id'], $member['plan']['checksum'], $member['plan']['projection_checksum'],
                    $this->option('reviewer'), $this->option('evidence').' Group '.$group.'; snapshot '.$digest, true)];
                $confirmed[] = $manifest;
            }
            foreach (array_chunk($confirmed, 20) as $i => $parts) {
                $manifest = $parts[0];
                foreach (['selection', 'reviews', 'baseline_reviews'] as $key) {
                    $manifest[$key] = array_merge(...array_column($parts, $key));
                }
                $files->write($output.'/'.sprintf('approved-part-%02d.manifest.json', $i + 1), $manifest);
            }
            $files->write($output.'/group-confirmation.json', ['group' => $group, 'bundle_checksum' => $digest,
                'ids' => $ids, 'reviewer' => $this->option('reviewer'), 'confirmed_at' => now()->toIso8601String(),
                'execute' => false, 'database_writes' => 0, 'import_authorized' => false]);
            $this->info('Exact group decision recorded through existing confirmations. Execute=false; live import NOT authorized.');

            return self::SUCCESS;
        } catch (Throwable $e) {
            $this->error('Group confirmation refused: '.$e->getMessage());

            return self::FAILURE;
        }
    }
}
