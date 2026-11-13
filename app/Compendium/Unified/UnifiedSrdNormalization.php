<?php

namespace App\Compendium\Unified;

use InvalidArgumentException;

/** Narrow, evidence-backed extraction repairs. Never changes the pinned source payload. */
class UnifiedSrdNormalization
{
    public function pdfSource(array $record, string $kind): bool
    {
        $s = $record['source'] ?? [];
        $o = $record['official_reference'] ?? [];

        return $kind === 'magic_item' && ($s['file'] ?? null) === 'sources/SRD_CC_v5.2.1.pdf'
            && ($o['file'] ?? null) === $s['file'] && ($o['edition'] ?? null) === '2024'
            && ($o['kind'] ?? null) === $kind && ($o['name'] ?? null) === ($record['name_en'] ?? null)
            && ! empty($s['pages']) && ($s['pages'] ?? null) === ($o['pages'] ?? null)
            && ! empty($o['lines']) && ! isset($s['commit']) && ! isset($s['url']);
    }

    public function mapping(array $record, string $kind): array
    {
        $raw = $record['raw'];
        $repairs = [];
        $lines = $record['official_reference']['lines'] ?? [];
        $official = $record['official_reference'] ?? [];
        if ($kind === 'spell' && ($official['edition'] ?? null) === '2024'
            && ($official['kind'] ?? null) === 'spell' && ($official['name'] ?? null) === $record['name_en']) {
            // Recover only header text which exactly agrees with the already-curated
            // field. Do not use broad punctuation replacement or prose interpretation.
            $componentLines = [];
            $inComponents = false;
            foreach ($lines as $line) {
                if (str_starts_with($line, 'Duration:')) {
                    break;
                }
                if (str_starts_with($line, 'Components:')) {
                    $inComponents = true;
                }
                if ($inComponents) {
                    $componentLines[] = $line;
                }
            }
            if (preg_match('/^Components: [VSM](?:, [VSM])* \((.+)\)$/D', implode(' ', $componentLines), $m)
                && ($record['mechanics']['material'] ?? null) === $m[1] && ($raw['material'] ?? null) !== $m[1]) {
                $repairs['material'] = ['before' => $raw['material'] ?? null, 'after' => $m[1], 'evidence' => implode(' ', $componentLines)];
                $raw['material'] = $m[1];
            }
            foreach ($lines as $line) {
                if (preg_match('/^Duration: Concentration,? (up to .+)$/D', $line, $m)
                    && ($record['mechanics']['concentration'] ?? null) === true && ($record['mechanics']['duration'] ?? null) === $m[1]) {
                    foreach (['duration' => $m[1], 'concentration' => true] as $field => $value) {
                        if (($raw[$field] ?? null) !== $value) {
                            $repairs[$field] = ['before' => $raw[$field] ?? null, 'after' => $value, 'evidence' => $line];
                            $raw[$field] = $value;
                        }
                    }
                }
            }
        }
        if ($kind === 'spell' && ($raw['components'] ?? null) === []
            && preg_match('/^(.+?) Component: ([VSM](?:, [VSM])*)$/D', $raw['range'] ?? '', $m)
            && in_array('Range: '.$m[1], $lines, true) && in_array('Component: '.$m[2], $lines, true)) {
            $components = explode(', ', $m[2]);
            if (count(array_unique($components)) !== count($components) || in_array('M', $components, true)) {
                throw new InvalidArgumentException('Ambiguous singular component extraction.');
            }
            $repairs['range'] = ['before' => $raw['range'], 'after' => $m[1], 'evidence' => 'official_reference.lines: Range + Component'];
            $repairs['components'] = ['before' => [], 'after' => $components, 'evidence' => 'official_reference.lines: Component'];
            $raw['range'] = $m[1];
            $raw['components'] = $components;
        }
        if ($kind === 'magic_item' && ! isset($raw['rarity']) && $this->pdfSource($record, $kind)) {
            $headers = [];
            foreach ($lines as $line) {
                if (preg_match('/^(?:Wondrous Item|Potion|Rod|Ring|Staff|Wand|Weapon \([^)]*\)|Armor \([^)]*\)), (Common|Uncommon|Rare|Very Rare|Legendary|Artifact)(?:$| \(Requires)/D', $line, $m)) {
                    $headers[] = ['name' => $m[1], 'line' => $line];
                }
            }
            if (count($headers) === 1) {
                $raw['rarity'] = ['name' => $headers[0]['name']];
                $repairs['rarity'] = ['before' => null, 'after' => $raw['rarity'], 'evidence' => $headers[0]['line']];
            }
        }
        // Supplement contains bare numbers with no unit. Keep them as source evidence,
        // never assume gp or coerce them to the normal cost object.
        if ($kind === 'equipment' && ($record['source']['file'] ?? null) === 'sources/2024/en/5e-SRD-Poisons.json'
            && is_numeric($raw['cost'] ?? null) && ! is_array($raw['cost'])) {
            $repairs['cost'] = ['before' => $raw['cost'], 'after' => null, 'evidence' => 'poison supplement omits currency unit; human decision required'];
            unset($raw['cost']);
        }

        return [$raw, $repairs];
    }
}
