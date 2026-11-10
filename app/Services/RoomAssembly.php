<?php

namespace App\Services;

/** Parametric room boolean operations. The resulting graph is the sole physical/render axis. */
class RoomAssembly
{
    public static function editable(array $graph): array
    {
        if (empty($graph['assemblies'])) {
            return $graph;
        }
        $prefixes = array_map(fn ($a) => $a['id'].'-', $graph['assemblies']);
        $owned = fn ($id) => count(array_filter($prefixes, fn ($p) => str_starts_with($id, $p))) > 0;
        $result = [];
        foreach (['vertices', 'edges', 'rooms', 'openings'] as $kind) {
            $entries = array_filter($graph[$kind] ?? [], fn ($e) => ! $owned($e[$kind === 'openings' ? 'edgeId' : 'id']));
            foreach ($graph['assemblies'] as $assembly) {
                foreach ($assembly['sources'] as $source) {
                    array_push($entries, ...($source['graph'][$kind] ?? []));
                }
            }
            $result[$kind] = array_values(array_column($entries, null, 'id'));
        }

        return $result;
    }

    private const ISSUE = 'Операция затрагивает проём. Переместите или удалите его отдельным действием.';

    private static function distance(array $a, array $b): float
    {
        return hypot($a['x'] - $b['x'], $a['y'] - $b['y']);
    }

    public static function contains(array $polygon, array $p): bool
    {
        $inside = false;
        for ($i = 0, $j = count($polygon) - 1; $i < count($polygon); $j = $i++) {
            $a = $polygon[$i];
            $b = $polygon[$j];
            if (($a['y'] > $p['y']) !== ($b['y'] > $p['y']) && $p['x'] < ($b['x'] - $a['x']) * ($p['y'] - $a['y']) / ($b['y'] - $a['y']) + $a['x']) {
                $inside = ! $inside;
            }
        }

        return $inside;
    }

    private static function nested(array $inner, array $outer): bool
    {
        $points = WallCurve::room($inner['rooms'][0], $inner);
        $polygon = WallCurve::room($outer['rooms'][0], $outer);
        $area = static function ($p) {
            $sum = 0;
            foreach ($p as $i => $a) {
                $b = $p[($i + 1) % count($p)];
                $sum += $a['x'] * $b['y'] - $b['x'] * $a['y'];
            }

            return abs($sum);
        };
        if ($area($points) >= $area($polygon) - .01) {
            return false;
        }
        foreach ($points as $p) {
            if (self::contains($polygon, $p)) {
                continue;
            }$boundary = false;
            foreach ($outer['edges'] as $e) {
                if (self::distance($p, self::project($p, $e, $outer)['point']) < .006) {
                    $boundary = true;
                    break;
                }
            }if (! $boundary) {
                return false;
            }
        }

        return true;
    }

    private static function at(array $edge, array $graph, float $t): array
    {
        if (isset($edge['curve'])) {
            return WallCurve::point($edge['curve'], $t);
        }
        $vertices = array_column($graph['vertices'], null, 'id');
        $a = $vertices[$edge['a']];
        $b = $vertices[$edge['b']];

        return ['x' => $a['x'] + ($b['x'] - $a['x']) * $t, 'y' => $a['y'] + ($b['y'] - $a['y']) * $t];
    }

    private static function implicit(array $p, array $edge, array $graph): float
    {
        if (isset($edge['curve'])) {
            $c = $edge['curve'];
            $r = deg2rad($c['rotation']);
            $x = $p['x'] - $c['cx'];
            $y = $p['y'] - $c['cy'];

            return (($x * cos($r) + $y * sin($r)) / $c['rx']) ** 2 + ((-$x * sin($r) + $y * cos($r)) / $c['ry']) ** 2 - 1;
        }
        $vertices = array_column($graph['vertices'], null, 'id');
        $a = $vertices[$edge['a']];
        $b = $vertices[$edge['b']];

        return (($b['x'] - $a['x']) * ($p['y'] - $a['y']) - ($b['y'] - $a['y']) * ($p['x'] - $a['x'])) / self::distance($a, $b);
    }

    private static function project(array $p, array $edge, array $graph): array
    {
        $path = WallCurve::path($edge, array_column($graph['vertices'], null, 'id'));
        $length = WallCurve::length($path);
        $offset = 0;
        $best = INF;
        $result = [];
        for ($i = 1; $i < count($path); $i++) {
            $a = $path[$i - 1];
            $b = $path[$i];
            $n = self::distance($a, $b);
            $u = max(0, min(1, (($p['x'] - $a['x']) * ($b['x'] - $a['x']) + ($p['y'] - $a['y']) * ($b['y'] - $a['y'])) / ($n * $n)));
            $q = ['x' => $a['x'] + ($b['x'] - $a['x']) * $u, 'y' => $a['y'] + ($b['y'] - $a['y']) * $u];
            $error = self::distance($p, $q);
            if ($error < $best) {
                $best = $error;
                $parameter = ($i - 1 + $u) / (count($path) - 1);
                $result = ['point' => isset($edge['curve']) ? WallCurve::point($edge['curve'], $parameter) : $q, 't' => ($offset + $n * $u) / $length, 'parameter' => $parameter];
            }
            $offset += $n;
        }

        return $result;
    }

    private static function intersections(array $a, array $ga, array $b, array $gb): array
    {
        if (! isset($a['curve']) && isset($b['curve'])) {
            return array_map(fn ($r) => [$r[1], $r[0]], self::intersections($b, $gb, $a, $ga));
        }
        if (isset($a['curve'], $b['curve']) && ! array_filter(['cx', 'cy', 'rx', 'ry', 'rotation'], fn ($k) => $a['curve'][$k] != $b['curve'][$k])) {
            $candidates = [0, 1, self::project(self::at($b, $gb, 0), $a, $ga)['parameter'], self::project(self::at($b, $gb, 1), $a, $ga)['parameter']];
            $result = [];
            foreach ($candidates as $t) {
                $p = self::at($a, $ga, $t);
                $q = self::project($p, $b, $gb);
                if (self::distance($p, $q['point']) < .006) {
                    $result[] = [$t, $q['parameter']];
                }
            }

            return $result;
        }
        $count = isset($a['curve']) ? max(72, (int) ceil(abs($a['curve']['sweep']) * 2)) : 1;
        $roots = [];
        $left = 0;
        $fl = self::implicit(self::at($a, $ga, 0), $b, $gb);
        for ($i = 1; $i <= $count; $i++) {
            $right = $i / $count;
            $fr = self::implicit(self::at($a, $ga, $right), $b, $gb);
            if (abs($fl) < 1e-8) {
                $roots[] = $left;
            }
            if ($fl * $fr < 0) {
                $lo = $left;
                $hi = $right;
                $f = $fl;
                for ($n = 0; $n < 36; $n++) {
                    $mid = ($lo + $hi) / 2;
                    $fm = self::implicit(self::at($a, $ga, $mid), $b, $gb);
                    if ($fm * $f > 0) {
                        $lo = $mid;
                        $f = $fm;
                    } else {
                        $hi = $mid;
                    }
                }
                $roots[] = ($lo + $hi) / 2;
            }
            if ($i === $count && abs($fr) < 1e-8) {
                $roots[] = $right;
            }
            $left = $right;
            $fl = $fr;
        }
        if (! isset($a['curve']) && ! isset($b['curve']) && abs(self::implicit(self::at($a, $ga, 0), $b, $gb)) < .003 && abs(self::implicit(self::at($a, $ga, 1), $b, $gb)) < .003) {
            foreach ([0, 1] as $t) {
                $roots[] = self::project(self::at($b, $gb, $t), $a, $ga)['t'];
            }
        }
        $result = [];
        foreach ($roots as $t) {
            $p = self::at($a, $ga, $t);
            $q = self::project($p, $b, $gb);
            if (self::distance($p, $q['point']) > .006 || array_filter($result, fn ($r) => abs($r[0] - $t) < 1e-6)) {
                continue;
            }
            $result[] = [$t, isset($b['curve']) ? $q['parameter'] : $q['t']];
        }

        return $result;
    }

    public static function compile(array $assembly, bool $floorOnly = false): array
    {
        $sources = $assembly['sources'];
        $id = $assembly['id'];
        $polygons = array_map(fn ($s) => WallCurve::room($s['graph']['rooms'][0], $s['graph']), $sources);
        $sourceOrder = [];
        foreach ($sources as $j => $s) {
            $previous = array_slice($sources, 0, $j);
            $coverage = function ($p, $strict = false) use ($previous, $polygons) {
                foreach ($previous as $i => $o) {
                    $boundary = false;
                    foreach ($o['graph']['edges'] as $e) {
                        if (self::distance($p, self::project($p, $e, $o['graph'])['point']) < .006) {
                            $boundary = true;
                            break;
                        }
                    }$inside = self::contains($polygons[$i], $p);
                    if ($strict ? ($inside && ! $boundary) : ($inside || $boundary)) {
                        return true;
                    }
                }

return false;
            };
            $enclosed = count($previous) > 0;
            $interior = false;
            foreach ($s['graph']['edges'] as $edge) {
                if (! $enclosed) {
                    break;
                }
                $cuts = [0, 1];
                foreach ($previous as $o) {
                    foreach ($o['graph']['edges'] as $other) {
                        foreach (self::intersections($edge, $s['graph'], $other, $o['graph']) as [$t]) {
                            $cuts[] = $t;
                        }
                    }
                }sort($cuts);
                foreach ($cuts as $n => $t) {
                    $p = self::at($edge, $s['graph'], $t);
                    $mid = self::at($edge, $s['graph'], ($t + ($cuts[$n + 1] ?? $t)) / 2);
                    $interior = $interior || $coverage($p, true) || $coverage($mid, true);
                    if (! $coverage($p) || ! $coverage($mid)) {
                        $enclosed = false;
                        break;
                    }
                }
            }
            $sourceOrder[] = ['j' => $j, 'depth' => count(array_filter($sources, fn ($o) => self::nested($s['graph'], $o['graph']))) + (int) ($enclosed && $interior)];
        }
        usort($sourceOrder, fn ($a, $b) => $b['depth'] <=> $a['depth'] ?: $a['j'] <=> $b['j']);
        $boundary = function ($i, $p) use ($sources) {
            foreach ($sources[$i]['graph']['edges'] as $e) {
                if (self::distance($p, self::project($p, $e, $sources[$i]['graph'])['point']) < .006) {
                    return true;
                }
            }

            return false;
        };
        $inside = function ($i, $p) use ($sources, $polygons, $boundary) {
            $edges = $sources[$i]['graph']['edges'];
            if (isset($edges[0]['curve']) && ! array_filter($edges, fn ($e) => ($e['curve']['group'] ?? null) !== $edges[0]['curve']['group'])) {
                return self::implicit($p, $edges[0], $sources[$i]['graph']) < -1e-7;
            }

            return self::contains($polygons[$i], $p) && ! $boundary($i, $p);
        };
        $rows = [];
        foreach ($sources as $source => $s) {
            foreach ($s['graph']['edges'] as $ordinal => $edge) {
                $rows[] = compact('edge', 'source', 'ordinal') + ['cuts' => [0, 1]];
            }
        }
        for ($i = 0; $i < count($rows); $i++) {
            for ($j = 0; $j < $i; $j++) {
                $a = $rows[$i];
                $b = $rows[$j];
                if ($a['source'] === $b['source']) {
                    continue;
                }
                foreach (self::intersections($a['edge'], $sources[$a['source']]['graph'], $b['edge'], $sources[$b['source']]['graph']) as [$t, $u]) {
                    $rows[$i]['cuts'][] = $t;
                    $rows[$j]['cuts'][] = $u;
                }
            }
        }
        $result = ['vertices' => [], 'edges' => [], 'rooms' => [], 'openings' => []];
        $vertex = function ($p) use (&$result, $id) {
            foreach ($result['vertices'] as $v) {
                if (self::distance($v, $p) < .006) {
                    return $v['id'];
                }
            }
            $v = ['id' => $id.'-v'.count($result['vertices']), 'x' => round($p['x'], 3), 'y' => round($p['y'], 3)];
            $result['vertices'][] = $v;

            return $v['id'];
        };
        foreach ($rows as $row) {
            ['edge' => $edge, 'source' => $source, 'ordinal' => $ordinal] = $row;
            $graph = $sources[$source]['graph'];
            $vertices = array_column($graph['vertices'], null, 'id');
            $cuts = array_values(array_unique(array_map(fn ($t) => round($t, 8), $row['cuts'])));
            sort($cuts);
            $parentLength = WallCurve::length(WallCurve::path($edge, $vertices));
            $openings = array_filter($graph['openings'] ?? [], fn ($o) => $o['edgeId'] === $edge['id']);
            for ($n = 1; $n < count($cuts); $n++) {
                $start = $cuts[$n - 1];
                $end = $cuts[$n];
                if ($end - $start < 1e-7) {
                    continue;
                }
                $mid = self::at($edge, $graph, ($start + $end) / 2);
                $previous = false;
                foreach (array_slice($sources, 0, $source) as $i => $_) {
                    $previous = $previous || $inside($i, $mid);
                }
                $removed = in_array($sources[$source]['mode'], ['trim', 'union'], true) && $previous;
                $pa = self::at($edge, $graph, $start);
                $pb = self::at($edge, $graph, $end);
                $size = self::distance($pa, $pb);
                $normal = ['x' => -($pb['y'] - $pa['y']) / $size * .1, 'y' => ($pb['x'] - $pa['x']) / $size * .1];
                $sides = [['x' => $mid['x'] + $normal['x'], 'y' => $mid['y'] + $normal['y']], ['x' => $mid['x'] - $normal['x'], 'y' => $mid['y'] - $normal['y']]];
                foreach ($sources as $i => $s) {
                    if ($i > $source && $s['mode'] === 'union' && $inside($i, $mid)) {
                        $removed = true;
                    }
                    if ($i !== $source && (($i > $source && $s['mode'] === 'union') || ($i < $source && $sources[$source]['mode'] === 'union')) && $boundary($i, $mid) && ! array_filter($sides, fn ($p) => ! $inside($source, $p) && ! $inside($i, $p))) {
                        $removed = true;
                    }
                }
                if ($floorOnly) {
                    $removed = false;
                }
                $fragment = array_replace($edge, ['id' => $id.'-e'.$source.'x'.$ordinal.'x'.($n - 1), 'a' => '', 'b' => '']);
                if (isset($edge['curve'])) {
                    $fragment['curve'] = array_replace($edge['curve'], ['start' => round($edge['curve']['start'] + $edge['curve']['sweep'] * $start, 6), 'sweep' => round($edge['curve']['sweep'] * ($end - $start), 6)]);
                }
                $offsetA = self::project($pa, $edge, $graph)['t'] * $parentLength;
                $offsetB = self::project($pb, $edge, $graph)['t'] * $parentLength;
                $mapped = [];
                foreach ($openings as $opening) {
                    $center = $opening['center'] * $parentLength;
                    if ($center < $offsetA - .003 || $center > $offsetB + .003) {
                        continue;
                    }
                    abort_if($removed || $center - $opening['width'] / 2 < $offsetA + $edge['thickness'] / 2 - .003 || $center + $opening['width'] / 2 > $offsetB - $edge['thickness'] / 2 + .003, 422, self::ISSUE);
                    $mapped[] = array_replace($opening, ['edgeId' => $fragment['id'], 'center' => round(($center - $offsetA) / ($offsetB - $offsetA), 8)]);
                }
                if ($removed) {
                    continue;
                }
                $fragment['a'] = $vertex($pa);
                $fragment['b'] = $vertex($pb);
                $duplicate = false;
                foreach ($result['edges'] as $e) {
                    if ((($e['a'] === $fragment['a'] && $e['b'] === $fragment['b']) || ($e['a'] === $fragment['b'] && $e['b'] === $fragment['a'])) && self::distance(self::at($e, $result, .5), $mid) < .006) {
                        $duplicate = true;
                    }
                }
                if ($duplicate) {
                    foreach ($mapped as $o) {
                        abort_unless(in_array($o['id'], array_column($result['openings'], 'id'), true), 422, self::ISSUE);
                    }

                    continue;
                }
                $result['edges'][] = $fragment;
                array_push($result['openings'], ...$mapped);
            }
        }
        $expectedOpenings = [];
        foreach ($sources as $s) {
            array_push($expectedOpenings, ...array_column($s['graph']['openings'] ?? [], 'id'));
        }
        abort_unless(count($result['openings']) === count(array_unique($expectedOpenings)), 422, self::ISSUE);
        $result['rooms'] = self::faces($result, $id, $floorOnly);
        abort_unless(count($result['rooms']), 422, 'Не удалось построить замкнутый контур помещений.');
        $result['floors'] = [];
        if ($floorOnly) {
            foreach ($result['rooms'] as $i => $room) {
                $points = $room['points'];
                $source = -1;
                foreach ($points as $n => $a) {
                    $b = $points[($n + 1) % count($points)];
                    $length = self::distance($a, $b);
                    if ($length < .001) {
                        continue;
                    }
                    $p = ['x' => ($a['x'] + $b['x']) / 2 - ($b['y'] - $a['y']) / $length * .05, 'y' => ($a['y'] + $b['y']) / 2 + ($b['x'] - $a['x']) / $length * .05];
                    if (! self::contains($points, $p)) {
                        continue;
                    }
                    foreach ($sourceOrder as $entry) {
                        if ($inside($entry['j'], $p)) {
                            $source = $entry['j'];
                            break;
                        }
                    }
                    if ($source >= 0) {
                        break;
                    }
                }
                abort_if($source < 0, 422, 'Не удалось определить материал области пола.');
                $result['floors'][] = ['id' => $id.'-f'.$i, 'points' => $points, 'materialVersionId' => $sources[$source]['graph']['rooms'][0]['materialVersionId']];
            }
        } else {
            $result['floors'] = self::compile($assembly, true)['floors'];
        }

        return $result;
    }

    private static function faces(array $graph, string $id, bool $withPoints = false): array
    {
        $vertices = array_column($graph['vertices'], null, 'id');
        $adjacency = [];
        $paths = [];
        foreach ($graph['edges'] as $i => $e) {
            $paths[$i] = WallCurve::path($e, $vertices);
            $adjacency[$e['a']][] = ['to' => $e['b'], 'edge' => $i];
            $adjacency[$e['b']][] = ['to' => $e['a'], 'edge' => $i];
        }
        foreach ($adjacency as $v => &$list) {
            $direction = function ($item) use ($v, $paths, $graph, $vertices) {
                $path = $paths[$item['edge']];
                $p = $graph['edges'][$item['edge']]['a'] === $v ? $path[1] : $path[count($path) - 2];
                $a = $vertices[$v];

                return atan2($p['y'] - $a['y'], $p['x'] - $a['x']);
            };
            usort($list, fn ($a, $b) => $direction($a) <=> $direction($b));
        }
        unset($list);
        $used = [];
        $faces = [];
        $polygons = [];
        foreach ($adjacency as $start => $list) {
            foreach ($list as $first) {
                $key = $start.':'.$first['edge'];
                if (isset($used[$key])) {
                    continue;
                }
                $loop = [];
                $points = [];
                $from = $start;
                $current = $first;
                do {
                    $used[$from.':'.$current['edge']] = true;
                    $loop[] = $from;
                    $e = $graph['edges'][$current['edge']];
                    $path = $paths[$current['edge']];
                    if ($e['a'] !== $from) {
                        $path = array_reverse($path);
                    }
                    array_push($points, ...array_slice($path, 0, -1));
                    $next = $adjacency[$current['to']];
                    $twin = array_search($current['edge'], array_column($next, 'edge'), true);
                    $from = $current['to'];
                    $current = $next[($twin + count($next) - 1) % count($next)];
                } while ($from.':'.$current['edge'] !== $key && count($loop) <= count($graph['edges']) * 2);
                $area = 0;
                foreach ($points as $i => $a) {
                    $b = $points[($i + 1) % count($points)];
                    $area += $a['x'] * $b['y'] - $b['x'] * $a['y'];
                }
                if ($area < 2 || count($loop) > 128 || count(array_unique($loop)) !== count($loop)) {
                    continue;
                }
                $faces[] = ['id' => $id.'-r'.count($faces), 'loop' => $loop, 'materialVersionId' => null];
                if ($withPoints) {
                    $faces[array_key_last($faces)]['points'] = $points;
                }
                $polygons[] = $points;
            }
        }

        return $faces;
    }

    public static function rebuild(array $graph): array
    {
        if (empty($graph['assemblies'])) {
            return $graph;
        }
        $prefixes = array_map(fn ($a) => $a['id'].'-', $graph['assemblies']);
        $before = $graph;
        $owned = fn ($id) => count(array_filter($prefixes, fn ($p) => str_starts_with($id, $p))) > 0;
        foreach (['vertices', 'edges', 'rooms', 'floors'] as $kind) {
            $graph[$kind] = array_values(array_filter($graph[$kind] ?? [], fn ($e) => ! $owned($e['id'])));
        }
        $graph['openings'] = array_values(array_filter($graph['openings'] ?? [], fn ($o) => ! $owned($o['edgeId'])));
        foreach ($graph['assemblies'] as $assembly) {
            $compiled = self::compile($assembly);
            foreach (['vertices', 'edges', 'rooms', 'floors', 'openings'] as $kind) {
                array_push($graph[$kind], ...$compiled[$kind]);
            }
        }

        return array_filter($graph['edges'], fn ($e) => ! $owned($e['id'])) ? StructureJunctions::connect($graph, $before) : $graph;
    }
}
