<?php

namespace App\Compendium\Unified;

use InvalidArgumentException;

/** Report/manifests for an explicit batch, using the unchanged <=20-record import contract. */
class UnifiedBatchPreparation
{
    public function __construct(private UnifiedBatchSelection $selection, private UnifiedDryRun $plans, private UnifiedContentChecks $checks) {}

    public function prepare(string $root, string $output, array $excluded, bool $offline = false, array $quotas = ['equipment' => 60, 'magic_item' => 40, 'spell' => 60], bool $all = false, ?string $reuseReview = null): array
    {
        if (file_exists($output) || ! mkdir($output, 0755, true)) {
            throw new InvalidArgumentException('Batch output must be a new directory.');
        }
        if (! $offline) {
            $excluded = array_values(array_unique([...$excluded, ...$this->selection->installedIds($root)]));
        }
        $catalog = $this->selection->select($root, $excluded, $quotas, $all);
        $reused = [];
        $reuseChecksum = null;
        if ($reuseReview !== null) {
            $prior = app(UnifiedJson::class)->read($reuseReview, limit: 67108864);
            $reuseChecksum = $prior['bundle_checksum'] ?? null;
            unset($prior['bundle_checksum']);
            if ($reuseChecksum !== UnifiedReview::digest($prior) || $prior['export'] !== $catalog['export'] || $prior['human_approvals'] !== 0) {
                throw new InvalidArgumentException('Prior review checksum/export/approval state changed.');
            }
            $byId = array_flip(array_column($catalog['selection'], 'id'));
            $order = [];
            foreach ($prior['records'] as $row) {
                $pos = $byId[$row['id']] ?? null;
                if ($pos === null || UnifiedReview::digest($catalog['selection'][$pos]) !== UnifiedReview::digest($row['selection']) || UnifiedReview::digest($catalog['selected_evidence'][$pos]) !== UnifiedReview::digest($row['source_evidence'])) {
                    throw new InvalidArgumentException('Previously screened source changed or left selection: '.$row['id']);
                }
                $order[] = $pos;
                $reused[$row['id']] = ['bundle_checksum' => $reuseChecksum, 'quality' => $row['quality'], 'semantic_approval' => 'still_pending'];
            }
            $order = [...$order, ...array_values(array_diff(array_keys($catalog['selection']), $order))];
            foreach (['selection', 'selected_evidence', 'selected_strata'] as $key) {
                $catalog[$key] = array_map(fn ($i) => $catalog[$key][$i], $order);
            }
        }
        $rows = $chunks = $seen = $names = [];
        foreach (array_chunk($catalog['selection'], 20) as $i => $selection) {
            $file = sprintf('part-%02d.manifest.json', $i + 1);
            $manifest = ['format' => 1, 'adapter_version' => UnifiedSrdAdapter::VERSION, 'source' => 'srd-2024', 'ruleset' => 'dnd-2024',
                'export' => $catalog['export'], 'selection' => $selection, 'reviews' => [], 'baseline_reviews' => []];
            $this->write($output.'/'.$file, $manifest);
            $plan = $this->plans->run($root, $output.'/'.$file, $offline);
            $this->write($output.'/'.sprintf('part-%02d.diff.json', $i + 1), $plan);
            $chunks[] = ['manifest' => $file, 'sha256' => hash_file('sha256', $output.'/'.$file), 'count' => count($selection),
                'plan_checksum' => $plan['plan_checksum'], 'actions' => $plan['actions']];
            foreach ($plan['records'] as $j => $row) {
                $selected = $selection[$j];
                $quality = $this->checks->check($row, $selected, $offline);
                $identity = ($selected['entity_type'] === 'spells' ? 'spell' : 'item').'|'.$selected['external_key'];
                if (isset($seen[$identity])) {
                    $quality['status'] = 'rejected';
                    $quality['hard_errors'][] = 'duplicate_batch_identity';
                    $rows[$seen[$identity]]['quality']['status'] = 'rejected';
                    $rows[$seen[$identity]]['quality']['hard_errors'][] = 'duplicate_batch_identity';
                }
                $seen[$identity] = count($rows);
                $name = mb_strtolower($row['normalized']['name'] ?? $row['id']);
                $names[($selected['kind'] === 'spell' ? 'spell|' : 'item|').$name][] = count($rows);
                $baseline = $row['baseline_assessment'] ?? [];
                $rows[] = ['ordinal' => count($rows) + 1, 'id' => $row['id'], 'kind' => $selected['kind'],
                    'stratum' => $catalog['selected_strata'][count($rows)], 'manifest' => $file,
                    'selection' => $selected, 'quality' => $quality, 'proposed_permissions' => ['browse' => true, 'copy' => true, 'execute' => false],
                    'source_evidence' => $catalog['selected_evidence'][count($rows)],
                    'prior_screening' => $reused[$row['id']] ?? null,
                    'baseline_proposal' => in_array($baseline['status'] ?? null, UnifiedCatalogPlan::BASELINE_POLICIES, true) ? [
                        'id' => $row['id'], 'policy' => $baseline['status'],
                        'entry_id' => $baseline['entry_id'], 'baseline_digest' => $baseline['baseline_digest'], 'confirmed' => false,
                    ] : null,
                    'plan' => $row];
            }
        }
        foreach ($names as $indices) {
            if (count($indices) < 2) {
                continue;
            }
            foreach ($indices as $index) {
                $rows[$index]['quality']['attention'][] = 'duplicate_name_different_identity';
                if ($rows[$index]['quality']['status'] === 'validated_candidate') {
                    $rows[$index]['quality']['status'] = 'manual_review';
                }
            }
        }
        $groups = $stats = [];
        foreach ($rows as &$row) {
            $status = $row['quality']['status'];
            $stats[$status] = ($stats[$status] ?? 0) + 1;
            $shape = $row['quality']['checks']['both_equipment_descriptions_absent'] ?? false ? 'structured-only' : 'bilingual-prose';
            $group = $status.'--'.$row['kind'].'--'.$shape;
            if ($row['quality']['checks']['machine_local_translation'] ?? false) {
                $group .= '--machine-translation';
            }
            $row['group'] = $group;
            $groups[$group][] = $row['id'];
        }
        unset($row);
        $bundle = ['format' => 1, 'adapter_version' => UnifiedSrdAdapter::VERSION, 'mode' => $offline ? 'offline-screening' : 'live-dry-run',
            'export' => $catalog['export'], 'source_total' => $catalog['source_total'], 'remaining' => $catalog['remaining'],
            'remaining_kinds' => $catalog['remaining_kinds'], 'inventory' => $catalog['inventory'],
            'excluded_ids' => $excluded, 'selected' => count($rows), 'counts' => array_replace(['validated_candidate' => 0, 'manual_review' => 0, 'rejected' => 0], $stats),
            'chunks' => $chunks, 'groups' => $groups, 'records' => $rows,
            'human_approvals' => 0, 'execute' => false, 'database_writes' => 0,
            'reused_screening_count' => count($reused), 'prior_bundle_checksum' => $reuseChecksum,
            'exact_rules_revision_verified' => false, 'semantic_approval' => 'pending_for_every_record'];
        $bundle['bundle_checksum'] = UnifiedReview::digest($bundle);
        $this->write($output.'/review.json', $bundle);

        return $bundle;
    }

    public function write(string $path, array $data): void
    {
        $h = @fopen($path, 'xb');
        if (! $h) {
            throw new InvalidArgumentException('Output must be a new file.');
        }
        try {
            $bytes = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
            if (fwrite($h, $bytes) !== strlen($bytes)) {
                throw new InvalidArgumentException('Incomplete report write.');
            }
        } finally {
            fclose($h);
        }
    }
}
