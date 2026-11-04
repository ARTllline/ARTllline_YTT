<?php

namespace App\Services;

use App\Models\Scene;
use App\Models\SceneNote;
use App\Models\SceneRegion;
use Illuminate\Validation\ValidationException;

/** Bounds never move entities. Check full footprints, including hidden props/tokens. */
class SceneBounds
{
    public static function validateResize(Scene $scene, int $width, int $height): void
    {
        if ($width >= $scene->width && $height >= $scene->height) {
            return;
        }
        $outside = fn ($right, $bottom) => ($width < $scene->width && $right > $width + 0.001)
            || ($height < $scene->height && $bottom > $height + 0.001);
        StructuralGeometry::inside(StructureData::graph($scene), $width, $height);
        $terrain = app(TerrainData::class);
        foreach ($terrain->chunks($scene)->get() as $chunk) {
            if (! $outside(($chunk->x + 1) * 256, ($chunk->y + 1) * 256)) continue;
            foreach ($terrain->read($scene, $chunk->x.':'.$chunk->y) as $mask) {
                for ($i = 0; $i < 16384; $i++) {
                    if (ord($mask[$i]) && $outside($chunk->x * 256 + ($i % 128) * 2 + 2, $chunk->y * 256 + intdiv($i, 128) * 2 + 2)) {
                        throw ValidationException::withMessages(['bounds' => 'Новые границы оставят покрытие за пределами карты. Сначала сотрите его.']);
                    }
                }
            }
        }
        foreach ($scene->tokens()->get() as $token) {
            $radius = $token->size * $token->scale / 2;
            if ($outside($token->x + $radius, $token->y + $radius)) {
                throw ValidationException::withMessages(['bounds' => 'Новые границы оставят токены за пределами карты. Увеличьте карту или сначала переместите токены.']);
            }
        }
        foreach ($scene->props()->with('asset')->get() as $prop) {
            $r = deg2rad((float) $prop->rotation);
            $snapshot = $prop->preset_snapshot;
            $w = ($snapshot['width'] ?? $prop->asset?->width ?? 96) * $prop->scale_x / 2;
            $h = ($snapshot['height'] ?? $prop->asset?->height ?? 96) * $prop->scale_y / 2;
            $dx = (1 - 2 * ($snapshot['pivotX'] ?? 0.5)) * $w;
            $dy = (1 - 2 * ($snapshot['pivotY'] ?? 0.5)) * $h;
            $cos = cos($r);
            $sin = sin($r);
            if ($outside($prop->x + $dx * $cos - $dy * $sin + abs($cos) * $w + abs($sin) * $h,
                $prop->y + $dx * $sin + $dy * $cos + abs($sin) * $w + abs($cos) * $h)) {
                throw ValidationException::withMessages(['bounds' => 'Новые границы оставят объекты за пределами карты. Увеличьте карту или сначала переместите объекты.']);
            }
        }
        foreach (SceneRegion::where('scene_id', $scene->id)->get() as $region) {
            $g = $region->geometry;
            $right = $g['x'] + ($region->shape === 'circle' ? $g['radius'] : $g['width']);
            $bottom = $g['y'] + ($region->shape === 'circle' ? $g['radius'] : $g['height']);
            if ($outside($right, $bottom)) {
                throw ValidationException::withMessages(['bounds' => 'Новые границы оставят игровые области за пределами карты. Сначала переместите или измените области.']);
            }
        }
        foreach (SceneNote::where('scene_id', $scene->id)->get() as $note) {
            if ($outside($note->x, $note->y)) {
                throw ValidationException::withMessages(['bounds' => 'Новые границы оставят заметки за пределами карты. Сначала переместите заметки.']);
            }
        }
    }
}
