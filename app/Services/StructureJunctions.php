<?php

namespace App\Services;

use Illuminate\Support\Str;

/** Straight-wall T/X junctions. Every original wall keeps its first fragment's ID. */
class StructureJunctions
{
    public static function connect(array $graph, array $before): array
    {
        $old = array_column($before['vertices'], null, 'id');
        $ordered = $graph['vertices'];
        $stationary = static fn ($v) => isset($old[$v['id']]) && hypot($v['x'] - $old[$v['id']]['x'], $v['y'] - $old[$v['id']]['y']) < .0015;
        usort($ordered, fn ($a, $b) => (int) $stationary($b) <=> (int) $stationary($a));
        $vertices = $aliases = [];
        foreach ($ordered as $v) {
            $shared = self::near($vertices, $v);
            $aliases[$v['id']] = $shared['id'] ?? $v['id'];
            if (! $shared) {
                $vertices[$v['id']] = $v;
            }
        }
        foreach ($graph['edges'] as &$e) {
            $e['a'] = $aliases[$e['a']] ?? $e['a'];
            $e['b'] = $aliases[$e['b']] ?? $e['b'];
        }
        unset($e);
        foreach ($graph['rooms'] as &$room) {
            $room['loop'] = array_map(fn ($id) => $aliases[$id] ?? $id, $room['loop']);
        }
        unset($room);
        $straight = array_values(array_filter($graph['edges'], fn ($e) => ! isset($e['curve'])));
        foreach ($straight as $i => $edge) {
            $a = $vertices[$edge['a']] ?? null;
            $b = $vertices[$edge['b']] ?? null;
            abort_unless($a && $b, 422, 'Отсутствует вершина стены.');
            foreach (array_slice($straight, 0, $i) as $other) {
                $c = $vertices[$other['a']] ?? null;
                $d = $vertices[$other['b']] ?? null;
                abort_unless($c && $d, 422, 'Отсутствует вершина стены.');
                $ux = $b['x'] - $a['x'];
                $uy = $b['y'] - $a['y'];
                $vx = $d['x'] - $c['x'];
                $vy = $d['y'] - $c['y'];
                $cross = $ux * $vy - $uy * $vx;
                if (abs($cross) < 1e-8) {
                    continue;
                }
                $t = (($c['x'] - $a['x']) * $vy - ($c['y'] - $a['y']) * $vx) / $cross;
                $s = (($c['x'] - $a['x']) * $uy - ($c['y'] - $a['y']) * $ux) / $cross;
                if ($t < 0 || $t > 1 || $s < 0 || $s > 1) {
                    continue;
                }
                $point = ['x' => round($a['x'] + $ux * $t, 3), 'y' => round($a['y'] + $uy * $t, 3)];
                if (! self::near($vertices, $point)) {
                    $id = 'v'.Str::uuid()->getHex()->toString();
                    $vertices[$id] = ['id' => $id] + $point;
                    abort_if(count($vertices) > 512, 422, 'Достигнут предел структуры (512 вершин).');
                }
            }
        }
        $edges = [];
        foreach ($graph['edges'] as $edge) {
            if (isset($edge['curve'])) {
                $edges[] = $edge;

                continue;
            }
            $a = $vertices[$edge['a']];
            $b = $vertices[$edge['b']];
            $dx = $b['x'] - $a['x'];
            $dy = $b['y'] - $a['y'];
            $length = hypot($dx, $dy);
            abort_if($length < 1, 422, 'Стена становится слишком короткой.');
            $cuts = [];
            foreach ($vertices as $v) {
                if ($v['id'] === $a['id'] || $v['id'] === $b['id']) {
                    continue;
                }
                $t = (($v['x'] - $a['x']) * $dx + ($v['y'] - $a['y']) * $dy) / ($length * $length);
                if ($t > 0 && $t < 1 && hypot($a['x'] + $dx * $t - $v['x'], $a['y'] + $dy * $t - $v['y']) < .0015) {
                    $cuts[] = ['t' => $t, 'id' => $v['id']];
                }
            }
            usort($cuts, fn ($u, $v) => $u['t'] <=> $v['t']);
            foreach ($cuts as $cut) {
                foreach ($graph['openings'] ?? [] as $o) {
                    abort_if($o['edgeId'] === $edge['id'] && abs($o['center'] - $cut['t']) * $length < ($o['width'] + $edge['thickness']) / 2,
                        422, 'Разрез слишком близко к проёму.');
                }
            }
            $path = [['t' => 0, 'id' => $a['id']], ...$cuts, ['t' => 1, 'id' => $b['id']]];
            $originalOpenings = $graph['openings'] ?? [];
            for ($i = 1; $i < count($path); $i++) {
                $from = $path[$i - 1];
                $to = $path[$i];
                $fragment = array_replace($edge, ['a' => $from['id'], 'b' => $to['id'],
                    'id' => $i === 1 ? $edge['id'] : 'e'.Str::uuid()->getHex()->toString()]);
                $edges[] = $fragment;
                abort_if(count($edges) > 512, 422, 'Достигнут предел структуры (512 стен).');
                foreach ($originalOpenings as $key => $opening) {
                    if ($opening['edgeId'] === $edge['id'] && $opening['center'] >= $from['t'] && $opening['center'] <= $to['t']) {
                        $graph['openings'][$key] = array_replace($opening, ['edgeId' => $fragment['id'],
                            'center' => round(($opening['center'] - $from['t']) / ($to['t'] - $from['t']), 8)]);
                    }
                }
            }
            if ($cuts) {
                foreach ($graph['rooms'] as &$room) {
                    $loop = [];
                    foreach ($room['loop'] as $i => $id) {
                        $loop[] = $id;
                        $end = $room['loop'][($i + 1) % count($room['loop'])];
                        if ($id === $a['id'] && $end === $b['id']) {
                            array_push($loop, ...array_column($cuts, 'id'));
                        } elseif ($id === $b['id'] && $end === $a['id']) {
                            array_push($loop, ...array_reverse(array_column($cuts, 'id')));
                        }
                    }
                    $room['loop'] = $loop;
                }
                unset($room);
            }
        }
        $graph['vertices'] = array_values($vertices);
        $graph['edges'] = $edges;

        return self::coincident($graph, $before);
    }

    private static function coincident(array $graph, array $before): array
    {
        $vertices = array_column($graph['vertices'], null, 'id');
        $oldVertices = array_column($before['vertices'], null, 'id');
        $oldEdges = array_column($before['edges'], null, 'id');
        $pairs = [];
        $hasOpening = fn ($e) => count(array_filter($graph['openings'] ?? [], fn ($o) => $o['edgeId'] === $e['id'])) > 0;
        $stationary = function ($e) use ($vertices, $oldVertices, $oldEdges) {
            $old = $oldEdges[$e['id']] ?? null;

            return $old && hypot($vertices[$e['a']]['x'] - $oldVertices[$old['a']]['x'], $vertices[$e['a']]['y'] - $oldVertices[$old['a']]['y']) < .0015 && hypot($vertices[$e['b']]['x'] - $oldVertices[$old['b']]['x'], $vertices[$e['b']]['y'] - $oldVertices[$old['b']]['y']) < .0015;
        };
        foreach ($graph['edges'] as $edge) {
            $key = StructuralGeometry::pair($edge['a'], $edge['b']);
            $other = $pairs[$key] ?? null;
            if (! $other) {
                $pairs[$key] = $edge;

                continue;
            }
            abort_if(isset($edge['curve']) || isset($other['curve']), 422, 'Кривые стены накладываются друг на друга.');
            $prefer = $hasOpening($edge) > $hasOpening($other) || ($hasOpening($edge) === $hasOpening($other) && $stationary($edge) > $stationary($other));
            $winner = $prefer ? $edge : $other;
            $loser = $prefer ? $other : $edge;
            $winner['thickness'] = max($winner['thickness'], $loser['thickness']);
            foreach (['blocksMovement', 'blocksVision', 'blocksLight'] as $flag) {
                $winner[$flag] = ($winner[$flag] ?? true) || ($loser[$flag] ?? true);
            }
            foreach ($graph['openings'] ?? [] as $i => $opening) {
                if ($opening['edgeId'] === $loser['id']) {
                    $opening['edgeId'] = $winner['id'];
                    if ($loser['a'] !== $winner['a']) {
                        $opening['center'] = round(1 - $opening['center'], 8);
                        if ($opening['type'] === 'door') {
                            $opening['hinge'] = $opening['hinge'] === 'a' ? 'b' : 'a';
                            $opening['direction'] = $opening['direction'] === 'left' ? 'right' : 'left';
                        }
                    }
                    $graph['openings'][$i] = $opening;
                }
            }
            $pairs[$key] = $winner;
        }
        $graph['edges'] = array_values($pairs);

        return $graph;
    }

    private static function near(array $vertices, array $point): ?array
    {
        foreach ($vertices as $v) {
            if (hypot($v['x'] - $point['x'], $v['y'] - $point['y']) < .0015) {
                return $v;
            }
        }

        return null;
    }
}
