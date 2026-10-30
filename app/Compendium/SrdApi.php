<?php

namespace App\Compendium;

use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/** Import transport only. Gameplay and browser endpoints never resolve this service. */
class SrdApi
{
    public const BASE = 'https://www.dnd5eapi.co/api/2024';

    public const ENDPOINTS = ['spells', 'equipment', 'monsters', 'conditions', 'skills',
        'ability-scores', 'damage-types', 'magic-schools', 'weapon-properties', 'weapon-mastery-properties', 'equipment-categories'];

    public function fetch(array $endpoints, ?callable $progress = null): array
    {
        $records = [];
        foreach ($endpoints as $endpoint) {
            if (! in_array($endpoint, self::ENDPOINTS, true)) {
                throw new RuntimeException('Unsupported SRD endpoint.');
            }
            $list = Http::acceptJson()->timeout(30)->retry(3, 500)->withOptions(['allow_redirects' => false])->get(self::BASE.'/'.$endpoint)->throw()->json();
            if (! isset($list['results'], $list['count']) || count($list['results']) !== $list['count'] || $list['count'] < 1) {
                throw new RuntimeException('Incomplete SRD index: '.$endpoint);
            }
            foreach (array_chunk($list['results'], 8) as $chunk) {
                foreach ($chunk as $entry) {
                    if (! preg_match('/^[a-z0-9][a-z0-9-]*$/', $entry['index'] ?? '') || ($entry['url'] ?? '') !== '/api/2024/'.$endpoint.'/'.$entry['index']) {
                        throw new RuntimeException('Invalid SRD index identity: '.$endpoint);
                    }
                }
                $responses = Http::pool(fn (Pool $pool) => array_map(fn ($entry) => $pool->as($entry['index'])->acceptJson()->timeout(30)->retry(3, 500)->withOptions(['allow_redirects' => false])->get(self::BASE.'/'.$endpoint.'/'.$entry['index']), $chunk));
                foreach ($chunk as $entry) {
                    $response = $responses[$entry['index']];
                    if ($response instanceof \Throwable) {
                        throw $response;
                    }
                    $raw = $response->throw()->json();
                    if (($raw['index'] ?? null) !== $entry['index'] || empty($raw['name'])) {
                        throw new RuntimeException('Invalid SRD detail: '.$entry['index']);
                    }
                    $records[] = ['endpoint' => $endpoint, 'data' => $raw];
                }
                if ($progress) {
                    $progress($endpoint, count($records));
                }
            }
        }

        return $records;
    }
}
