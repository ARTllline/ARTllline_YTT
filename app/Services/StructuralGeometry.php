<?php

namespace App\Services;

use App\Models\Scene;
use Illuminate\Validation\ValidationException;

class StructuralGeometry
{
    public static function forScene(Scene $scene): array
    {
        return self::compile(StructureData::graph($scene), $scene->props()->whereNotNull('preset_snapshot')->cursor());
    }

    /** Wall runs have round junction caps and flat aperture ends. */
    public static function compile(array $graph, iterable $props = []): array
    {
        $vertices = array_column($graph['vertices'], null, 'id');
        $openings = self::openingsByEdge($graph);
        $segments = [];
        foreach ($graph['edges'] as $edge) {
            $a = $vertices[$edge['a']];
            $b = $vertices[$edge['b']];
            $length = hypot($b['x'] - $a['x'], $b['y'] - $a['y']);
            $point = static fn ($t) => ['x' => $a['x'] + ($b['x'] - $a['x']) * $t,
                'y' => $a['y'] + ($b['y'] - $a['y']) * $t];
            $run = static fn ($id, $start, $end, $roundA, $roundB) => [
                'id' => $id, 'edgeId' => $edge['id'], 'a' => $start, 'b' => $end,
                'radius' => $edge['thickness'] / 2, 'roundA' => $roundA, 'roundB' => $roundB,
                'materialVersionId' => $edge['materialVersionId'],
                'blocksMovement' => $edge['blocksMovement'], 'blocksVision' => $edge['blocksVision'],
                'blocksLight' => $edge['blocksLight'],
            ];
            $start = $a;
            $previous = null;
            foreach ($openings[$edge['id']] ?? [] as $opening) {
                $half = $opening['width'] / (2 * $length);
                $left = $point($opening['center'] - $half);
                $right = $point($opening['center'] + $half);
                $segments[] = $run($edge['id'].':'.($previous ?? 'a').':'.$opening['id'], $start, $left, $previous === null, false);
                if ($opening['type'] === 'window' || ! $opening['open']) {
                    $panel = $run('opening:'.$opening['id'], $left, $right, false, false);
                    $panel['openingId'] = $opening['id'];
                    $panel['radius'] = min(4, $panel['radius']);
                    $panel['materialVersionId'] = null;
                    foreach (['blocksMovement', 'blocksVision', 'blocksLight'] as $flag) {
                        $panel[$flag] = $opening[$flag] ?? true;
                    }
                    $segments[] = $panel;
                }
                $start = $right;
                $previous = $opening['id'];
            }
            $segments[] = $run($previous === null ? $edge['id'] : $edge['id'].':'.$previous.':b',
                $start, $b, $previous === null, true);
        }

        $shapes = array_map(fn ($segment) => [
            'kind' => 'band', 'source' => isset($segment['openingId']) ? 'opening' : 'wall',
        ] + $segment, $segments);
        foreach ($props as $prop) {
            if ($collider = PropCollider::compile($prop)) {
                $shapes[] = $collider;
            }
        }

        return ['schemaVersion' => 2, 'segments' => $segments, 'shapes' => $shapes];
    }

    private static function openingsByEdge(array $graph): array
    {
        $groups = [];
        foreach ($graph['openings'] ?? [] as $opening) {
            $groups[$opening['edgeId']][] = $opening;
        }
        foreach ($groups as &$group) {
            usort($group, fn ($a, $b) => $a['center'] <=> $b['center']);
        }

        return $groups;
    }

    public static function inside(array $graph, int $width, int $height): void
    {
        unset($graph['openings']);
        foreach (self::compile($graph)['segments'] as $segment) {
            $radius = $segment['radius'];
            foreach ([$segment['a'], $segment['b']] as $point) {
                if ($point['x'] < $radius || $point['y'] < $radius || $width < $point['x'] + $radius || $height < $point['y'] + $radius) {
                    throw ValidationException::withMessages(['structure' => 'Стена с учётом толщины выходит за границы карты.']);
                }
            }
        }
    }

    public static function pair(string $a, string $b): string
    {
        return strcmp($a, $b) < 0 ? "$a:$b" : "$b:$a";
    }

    public static function validate(array $graph): void
    {
        $vertices = array_column($graph['vertices'], null, 'id');
        $positions = [];
        foreach ($vertices as $vertex) {
            $positions[$vertex['x'].':'.$vertex['y']] = true;
        }
        abort_unless(count($positions) === count($graph['vertices']), 422, 'В одной точке может быть только одна вершина.');

        $pairs = $used = $segments = [];
        foreach ($graph['edges'] as $edge) {
            $a = $vertices[$edge['a']] ?? null;
            $b = $vertices[$edge['b']] ?? null;
            abort_unless($a && $b && hypot($a['x'] - $b['x'], $a['y'] - $b['y']) >= 1, 422, 'Слишком короткая стена или отсутствующая вершина.');
            $key = self::pair($a['id'], $b['id']);
            abort_if(isset($pairs[$key]), 422, 'Между этими вершинами уже есть стена.');
            $pairs[$key] = true;
            $used[$a['id']] = $used[$b['id']] = true;
            foreach ($segments as [$c, $d]) {
                abort_if(self::crosses($a, $b, $c, $d), 422, 'Стены могут пересекаться только в общей вершине. Используйте привязку к стене.');
            }
            $segments[] = [$a, $b];
        }
        abort_unless(count($used) === count($vertices), 422, 'Каждая вершина должна принадлежать стене.');

        $edges = array_column($graph['edges'], null, 'id');
        foreach (self::openingsByEdge($graph) as $id => $openings) {
            $edge = $edges[$id] ?? null;
            abort_unless($edge, 422, 'Стена содержит проём. Сначала удалите проём.');
            $a = $vertices[$edge['a']];
            $b = $vertices[$edge['b']];
            $length = hypot($b['x'] - $a['x'], $b['y'] - $a['y']);
            $end = $edge['thickness'] / 2 - 1;
            foreach ($openings as $opening) {
                $left = $opening['center'] * $length - $opening['width'] / 2;
                $right = $left + $opening['width'];
                abort_if($left < $end + 1 || $right > $length - $edge['thickness'] / 2, 422,
                    'Проём пересекает другой проём или слишком близок к торцу стены.');
                $end = $right;
            }
        }

        foreach ($graph['rooms'] as $room) {
            $loop = $room['loop'];
            abort_unless(count(array_unique($loop)) === count($loop), 422, 'Контур комнаты должен быть простым.');
            $area = 0;
            foreach ($loop as $i => $id) {
                $next = $loop[($i + 1) % count($loop)];
                abort_unless(isset($pairs[self::pair($id, $next)]), 422, 'Контур комнаты должен состоять из стен.');
                $area += $vertices[$id]['x'] * $vertices[$next]['y'] - $vertices[$next]['x'] * $vertices[$id]['y'];
            }
            abort_if(abs($area) < 2, 422, 'Комната слишком мала.');
        }
    }

    public static function preserveOpenings(array $before, array $after): void
    {
        $oldEdges = array_column($before['edges'], null, 'id');
        $newEdges = array_column($after['edges'], null, 'id');
        $oldVertices = array_column($before['vertices'], null, 'id');
        $newVertices = array_column($after['vertices'], null, 'id');
        $openings = array_column($after['openings'] ?? [], null, 'id');
        foreach ($before['openings'] ?? [] as $old) {
            $opening = $openings[$old['id']] ?? null;
            if (! $opening) {
                abort_unless($before['vertices'] == $after['vertices'] && $before['edges'] == $after['edges'],
                    422, 'Сначала удалите проёмы отдельно от правки стен.');

                continue;
            }
            abort_unless($opening['type'] === $old['type'], 422, 'Тип существующего проёма нельзя изменить.');
            abort_if($old['type'] === 'door' && $old['locked'] && $old['open'] !== $opening['open'],
                422, 'Дверь заперта. Сначала отоприте замок.');
            $oldEdge = $oldEdges[$old['edgeId']];
            $newEdge = $newEdges[$opening['edgeId']];
            if ($oldEdge['id'] === $newEdge['id'] && $oldEdge['a'] === $newEdge['a'] && $oldEdge['b'] === $newEdge['b']) {
                continue;
            }

            $a = $oldVertices[$oldEdge['a']];
            $b = $oldVertices[$oldEdge['b']];
            $c = $newVertices[$newEdge['a']];
            $d = $newVertices[$newEdge['b']];
            $dx = $b['x'] - $a['x'];
            $dy = $b['y'] - $a['y'];
            $ex = $d['x'] - $c['x'];
            $ey = $d['y'] - $c['y'];
            $x = $a['x'] + $dx * $old['center'];
            $y = $a['y'] + $dy * $old['center'];
            // A split point and center are rounded by request canonicalization.
            $epsilon = 0.003;
            abort_unless($old['width'] == $opening['width']
                && abs($dx * $ey - $dy * $ex) / max(hypot($dx, $dy), hypot($ex, $ey)) <= $epsilon
                && hypot($x - $c['x'] - $ex * $opening['center'], $y - $c['y'] - $ey * $opening['center']) <= $epsilon,
                422, 'Правка стены должна сохранить положение проёма.');
            if ($old['type'] === 'door') {
                $reversed = $dx * $ex + $dy * $ey < 0;
                abort_unless(($opening['hinge'] !== $old['hinge']) === $reversed
                    && ($opening['direction'] !== $old['direction']) === $reversed,
                    422, 'Правка стены должна сохранить сторону открывания двери.');
            }
        }
    }

    public static function crosses(array $a, array $b, array $c, array $d): bool
    {
        if (max($a['x'], $b['x']) < min($c['x'], $d['x']) || max($c['x'], $d['x']) < min($a['x'], $b['x'])
            || max($a['y'], $b['y']) < min($c['y'], $d['y']) || max($c['y'], $d['y']) < min($a['y'], $b['y'])) {
            return false;
        }
        $side = static function ($p, $q, $r) {
            $cross = ($q['x'] - $p['x']) * ($r['y'] - $p['y']) - ($q['y'] - $p['y']) * ($r['x'] - $p['x']);

            return abs($cross) < 0.0000001 ? 0 : ($cross <=> 0);
        };
        $u = $side($a, $b, $c);
        $v = $side($a, $b, $d);
        $w = $side($c, $d, $a);
        $z = $side($c, $d, $b);
        foreach ([[$a, $b, $c, $u], [$a, $b, $d, $v], [$c, $d, $a, $w], [$c, $d, $b, $z]] as [$p, $q, $r, $sign]) {
            if ($sign === 0 && $r['id'] !== $p['id'] && $r['id'] !== $q['id']
                && $r['x'] >= min($p['x'], $q['x']) && $r['x'] <= max($p['x'], $q['x'])
                && $r['y'] >= min($p['y'], $q['y']) && $r['y'] <= max($p['y'], $q['y'])) {
                return true;
            }
        }

        return $u * $v < 0 && $w * $z < 0;
    }
}
