<?php

namespace Tests\Feature;

use App\Services\LineOfSight;
use PHPUnit\Framework\TestCase;

class RadialLineOfSightTest extends TestCase
{
    public function test_radial_broad_phase_preserves_exact_contacts_at_wraparound_tangencies_and_inside_bounds(): void
    {
        $shapes = [
            ['kind' => 'band', 'a' => ['x' => 50, 'y' => -90], 'b' => ['x' => 50, 'y' => 110], 'radius' => 4, 'roundA' => true, 'roundB' => false],
            ['kind' => 'ellipse', 'center' => ['x' => -70, 'y' => 0], 'radiusX' => 35, 'radiusY' => 11, 'rotation' => 37],
            ['kind' => 'ellipse', 'center' => ['x' => 100, 'y' => 20], 'radiusX' => 20, 'radiusY' => 20, 'rotation' => 0],
            ['kind' => 'polygon', 'points' => [['x' => -20, 'y' => 20], ['x' => 20, 'y' => 20], ['x' => 20, 'y' => 60]]],
        ];
        // Distant distractors exercise a different candidate set from the rectangular index.
        for ($i = 0; $i < 32; $i++) {
            $shapes[] = ['kind' => 'ellipse', 'center' => ['x' => cos($i) * 400, 'y' => sin($i) * 400],
                'radiusX' => 5 + $i, 'radiusY' => 3 + $i / 2, 'rotation' => $i * 13];
        }
        $shapes = array_map(fn ($shape, $id) => $shape + ['id' => (string) $id, 'source' => 'prop', 'blocksVision' => true], $shapes, array_keys($shapes));
        $los = new LineOfSight(['shapes' => $shapes]);
        foreach ([['x' => 0, 'y' => 0], ['x' => 0, 'y' => 40], ['x' => 50, 'y' => -94.00000005], ['x' => -250, 'y' => 130]] as $origin) {
            $buckets = $los->radialCandidates($origin, 512);
            for ($i = 0; $i < 512; $i++) {
                foreach ([0, 0.00000000001, .5, .99999999999] as $offset) {
                    $angle = ($i + $offset) * 2 * M_PI / 512;
                    $dx = cos($angle);
                    $dy = sin($angle);
                    $full = $los->clearDistance($origin, $dx, $dy, 650);
                    $indexed = $los->clearDistance($origin, $dx, $dy, 650, $buckets[$i]);
                    $this->assertSame($full, $indexed, "sector=$i offset=$offset origin=".json_encode($origin));
                }
            }
        }
    }
}
