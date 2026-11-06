<?php

namespace App\Services;

use App\Models\Scene;
use Illuminate\Support\Collection;

/** Gameplay light levels. Exact point queries and a bounded presentation field share light blockers. */
class SceneIllumination
{
    public const DARKNESS = 0;
    public const DIM = 1;
    public const BRIGHT = 2;

    public readonly int $ambient;
    private ?array $sources = null;
    private ?LineOfSight $los = null;
    private ?string $bits = null;

    public function __construct(private Scene $scene, private array $compiled, private Collection $tokens)
    {
        $brightness = $scene->lighting['brightness'] ?? 1;
        $this->ambient = match (true) {
            ! ($scene->lighting['enabled'] ?? false), $brightness >= .5 => self::BRIGHT,
            $brightness > 0 => self::DIM,
            default => self::DARKNESS,
        };
    }

    private function sources(): array
    {
        return $this->sources ??= array_values(array_filter(
            app(SceneLighting::class)->sources($this->scene, $this->tokens),
            fn ($source) => $source['intensity'] > 0
                && (! isset($source['tokenId']) || ! $this->tokens->get($source['tokenId'])->is_hidden),
        ));
    }

    public function nearbySources(array $eye): array
    {
        return array_values(array_filter($this->sources(), fn ($source) =>
            hypot($source['x'] - $eye['origin']['x'], $source['y'] - $eye['origin']['y']) < $source['radius'] + $eye['range']));
    }

    public function signature(array $nearby): array
    {
        // Above darkness every unobstructed point is already visible. Light edits then
        // update only the independent visual stream.
        if ($this->ambient !== self::DARKNESS) {
            return [];
        }

        $sources = array_map(fn ($source) => [$source['x'], $source['y'], $source['radius']], $nearby);
        $blockers = $sources ? $this->los()->geometryKey : null;

        return [$sources, $blockers];
    }

    private function los(): LineOfSight
    {
        return $this->los ??= new LineOfSight($this->compiled, 'blocksLight');
    }

    public function level(array $point): int
    {
        $level = $this->ambient;
        if ($level === self::BRIGHT) {
            return $level;
        }
        foreach ($this->sources() as $source) {
            $distance = hypot($source['x'] - $point['x'], $source['y'] - $point['y']);
            if ($distance >= $source['radius']) {
                continue;
            }
            $sourceLevel = $distance < $source['radius'] / 2 && $source['intensity'] >= .5 ? self::BRIGHT : self::DIM;
            if ($sourceLevel > $level && $this->los()->point($source, $point)['visible']) {
                $level = $sourceLevel;
                if ($level === self::BRIGHT) {
                    break;
                }
            }
        }

        return $level;
    }

    public function bits(): string
    {
        if ($this->bits !== null) {
            return $this->bits;
        }
        [$width, $height, $cell] = SceneLighting::dimensions($this->scene);
        $bits = str_repeat("\0", (int) ceil($width * $height / 8));
        foreach (app(SceneLighting::class)->masks($this->scene, $this->compiled, $this->sources(), $width, $height, $cell) as $entry) {
            $bits |= $entry['bits'];
        }

        return $this->bits = $bits;
    }
}
