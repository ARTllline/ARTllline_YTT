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
            if (isset($edge['curve'])) {
                foreach (WallCurve::runs($edge, $vertices, $openings[$edge['id']] ?? []) as $i => $run) {
                    $opening = $run['opening'] ?? null;
                    unset($run['opening']);
                    if (($opening['type'] ?? null) === 'door' && $opening['open']) {
                        continue;
                    }
                    $segment = $run + ['id' => $edge['id'].':curve:'.$i, 'edgeId' => $edge['id'],
                        'radius' => $edge['thickness'] / 2, 'materialVersionId' => $edge['materialVersionId'],
                        'blocksMovement' => $edge['blocksMovement'], 'blocksVision' => $edge['blocksVision'], 'blocksLight' => $edge['blocksLight']];
                    if ($opening) {
                        $segment['openingId'] = $opening['id'];
                        $segment['radius'] = min(4, $segment['radius']);
                        $segment['materialVersionId'] = null;
                        $segment = self::openingFlags($opening) + $segment;
                    }
                    $segments[] = $segment;
                }

                continue;
            }
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
                    $segments[] = self::openingFlags($opening) + $panel;
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

    private static function openingFlags(array $opening): array
    {
        if ($opening['type'] === 'door') {
            return array_intersect_key($opening, array_flip(['blocksMovement', 'blocksVision', 'blocksLight']))
                + ['blocksMovement' => true, 'blocksVision' => true, 'blocksLight' => true];
        }
        $opaque = ! ($opening['open'] ?? true);

        return ['blocksMovement' => true, 'blocksVision' => $opaque, 'blocksLight' => $opaque];
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

    public static function validate(array $graph, ?array $before = null): void
    {
        $vertices = array_column($graph['vertices'], null, 'id');
        $positions = [];
        foreach ($vertices as $vertex) {
            $positions[$vertex['x'].':'.$vertex['y']] = true;
        }
        abort_unless(count($positions) === count($graph['vertices']), 422, 'В одной точке может быть только одна вершина.');

        $pairs = $used = $segments = $groups = [];
        $budget = 0;
        foreach ($graph['edges'] as $edge) {
            $a = $vertices[$edge['a']] ?? null;
            $b = $vertices[$edge['b']] ?? null;
            abort_unless($a && $b && hypot($a['x'] - $b['x'], $a['y'] - $b['y']) >= (isset($edge['curve']) ? .01 : 1), 422, 'Слишком короткая стена или отсутствующая вершина.');
            $key = self::pair($a['id'], $b['id']);
            abort_if(isset($pairs[$key]), 422, 'Между этими вершинами уже есть стена.');
            $pairs[$key] = true;
            $used[$a['id']] = $used[$b['id']] = true;
            if (isset($edge['curve'])) {
                $curve = $edge['curve'];
                abort_unless(min($curve['rx'], $curve['ry']) >= max(8, $edge['thickness']) && abs($curve['sweep']) >= .01 && abs($curve['sweep']) < 360,
                    422, 'Недопустимый радиус или угол дуги.');
                abort_if($curve['kind'] === 'circle' && $curve['rx'] != $curve['ry'], 422, 'Радиусы круга должны совпадать.');
                foreach ([[$a, 0], [$b, 1]] as [$vertex, $t]) {
                    $p = WallCurve::point($curve, $t);
                    abort_if(hypot($p['x'] - $vertex['x'], $p['y'] - $vertex['y']) > .003, 422, 'Конец дуги не совпадает с вершиной.');
                }
                $shape = array_diff_key($curve, array_flip(['start', 'sweep']));
                abort_if(isset($groups[$curve['group']]) && $groups[$curve['group']] != $shape, 422, 'Части кривой должны иметь общую форму.');
                $groups[$curve['group']] = $shape;
            }
            $path = WallCurve::path($edge, $vertices);
            $budget += count($path) - 1;
            abort_if($budget > 4096, 422, 'Достигнут предел детализации стен (4096 сегментов).');
            for ($i = 1; $i < count($path); $i++) {
                $c = $path[$i - 1] + ['id' => $edge['id'].':'.($i - 1)];
                $d = $path[$i] + ['id' => $edge['id'].':'.$i];
                foreach ($segments as [$u, $v]) {
                    abort_if(self::crosses($c, $d, $u, $v), 422, 'Стены могут пересекаться только в общей вершине. Используйте привязку к стене.');
                }
                $segments[] = [$c, $d];
            }
        }
        abort_unless(count($used) === count($vertices), 422, 'Каждая вершина должна принадлежать стене.');

        $edges = array_column($graph['edges'], null, 'id');
        foreach (self::openingsByEdge($graph) as $id => $openings) {
            $edge = $edges[$id] ?? null;
            abort_unless($edge, 422, 'Стена содержит проём. Сначала удалите проём.');
            $length = WallCurve::length(WallCurve::path($edge, $vertices));
            $end = $edge['thickness'] / 2 - 1;
            foreach ($openings as $opening) {
                $left = $opening['center'] * $length - $opening['width'] / 2;
                $right = $left + $opening['width'];
                abort_if($left < $end + 1 || $right > $length - $edge['thickness'] / 2, 422,
                    'Проём пересекает другой проём или слишком близок к торцу стены.');
                $end = $right;
            }
        }

        $oldRooms = array_column($before['rooms'] ?? [], 'loop', 'id');
        foreach ($graph['rooms'] as $room) {
            $loop = $room['loop'];
            abort_unless(count(array_unique($loop)) === count($loop), 422, 'Контур комнаты должен быть простым.');
            foreach ($loop as $i => $id) {
                $next = $loop[($i + 1) % count($loop)];
                abort_unless(isset($pairs[self::pair($id, $next)]), 422, 'Контур комнаты должен состоять из стен.');
            }
            $area = self::pointArea(WallCurve::room($room, $graph));
            abort_if(abs($area) < 2, 422, 'Комната слишком мала.');
            $oldRoom = isset($oldRooms[$room['id']]) ? array_replace($room, ['loop' => $oldRooms[$room['id']]]) : null;
            abort_if($oldRoom && $area * self::pointArea(WallCurve::room($oldRoom, $before)) <= 0,
                422, 'Перемещение сворачивает контур комнаты.');
        }
    }

    private static function pointArea(array $points): float
    {
        $area = 0;
        foreach ($points as $i => $a) {
            $b = $points[($i + 1) % count($points)];
            $area += $a['x'] * $b['y'] - $b['x'] * $a['y'];
        }

        return $area;
    }

    public static function preserveOpenings(array $before, array $after): void
    {
        $before = RoomAssembly::editable($before);
        $after = RoomAssembly::editable($after);
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
            abort_if(isset($oldEdge['curve']) !== isset($newEdge['curve']), 422, 'Проём должен сохранить тип оси стены.');
            if ($oldEdge['id'] === $newEdge['id'] && $oldEdge['a'] === $newEdge['a'] && $oldEdge['b'] === $newEdge['b']) {
                continue;
            }

            if (isset($oldEdge['curve'], $newEdge['curve'])) {
                $oldCurve = $oldEdge['curve'];
                $newCurve = $newEdge['curve'];
                abort_unless(array_diff_key($oldCurve, array_flip(['start', 'sweep'])) == array_diff_key($newCurve, array_flip(['start', 'sweep'])), 422, 'Проём должен сохранить параметрическую ось стены.');
                $oldPath = WallCurve::path($oldEdge, $oldVertices);
                $newPath = WallCurve::path($newEdge, $newVertices);
                $p = WallCurve::along($oldPath, $old['center'] * WallCurve::length($oldPath));
                $q = WallCurve::along($newPath, $opening['center'] * WallCurve::length($newPath));
                abort_unless($old['width'] == $opening['width'] && hypot($p['x'] - $q['x'], $p['y'] - $q['y']) <= .03, 422, 'Правка стены должна сохранить положение проёма.');
                if ($old['type'] === 'door') {
                    $reversed = $oldCurve['sweep'] * $newCurve['sweep'] < 0;
                    abort_unless(($opening['hinge'] !== $old['hinge']) === $reversed && ($opening['direction'] !== $old['direction']) === $reversed, 422, 'Правка стены должна сохранить сторону открывания двери.');
                }

                continue;
            }
            $a = $oldVertices[$oldEdge['a']];
            $b = $oldVertices[$oldEdge['b']];
            // A translation and a junction may be accepted in the same transaction.
            // Measure the aperture on the moved parent axis, before its fragments.
            $parent = $newEdges[$oldEdge['id']] ?? null;
            if (! $parent) {
                $mapped = function ($id) use ($oldEdges, $newEdges, $newVertices) {
                    if (isset($newVertices[$id])) {
                        return $newVertices[$id];
                    }foreach ($oldEdges as $old) {
                        $next = $newEdges[$old['id']] ?? null;
                        if (! $next) {
                            continue;
                        }if ($old['a'] === $id) {
                            return $newVertices[$next['a']];
                        }if ($old['b'] === $id) {
                            return $newVertices[$next['b']];
                        }
                    }

return null;
                };
                $mappedA = $mapped($oldEdge['a']);
                $mappedB = $mapped($oldEdge['b']);
                if ($mappedA && $mappedB) {
                    $a = $mappedA;
                    $b = $mappedB;
                }
            }
            if ($parent && $parent['a'] !== $oldEdge['b']) {
                $movedA = $newVertices[$oldEdge['a']] ?? $newVertices[$parent['a']];
                $movedB = $newVertices[$oldEdge['b']] ?? [
                    'x' => $movedA['x'] + $b['x'] - $a['x'],
                    'y' => $movedA['y'] + $b['y'] - $a['y'],
                ];
                $a = $movedA;
                $b = $movedB;
            }
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
