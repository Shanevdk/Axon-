<?php

namespace App\Actions\Library;

use InvalidArgumentException;

/**
 * The server-side twin of `compileParts()` in `resources/js/lib/cad/library.ts`.
 *
 * The designer page compiles parts in the browser; this compiles the same
 * parts for clients with no browser — the MCP tools an AI designs through.
 * The two must agree: same primitives, same windings, same normalisation,
 * so an item is identical no matter who built it. Change them together.
 */
class CompileItemParts
{
    private const CYLINDER_SEGMENTS = 12;

    public const MAX_PARTS = 100;

    /**
     * Validation for a `parts` array, shared by every server-side author of
     * parts — the MCP design tool and the designer's AI drafts — so a part
     * means the same thing no matter who wrote it.
     *
     * @return array<string, array<int, string>|string>
     */
    public static function partRules(): array
    {
        return [
            'parts' => ['required', 'array', 'min:1', 'max:'.self::MAX_PARTS],
            'parts.*.shape' => ['required', 'string', 'in:box,cylinder,sketch'],
            'parts.*.name' => ['nullable', 'string', 'max:60'],
            'parts.*.width' => ['nullable', 'numeric', 'min:1', 'max:50000'],
            'parts.*.depth' => ['nullable', 'numeric', 'min:1', 'max:50000'],
            'parts.*.height' => ['required', 'numeric', 'min:1', 'max:50000'],
            'parts.*.x' => ['nullable', 'numeric', 'min:-50000', 'max:50000'],
            'parts.*.y' => ['nullable', 'numeric', 'min:-50000', 'max:50000'],
            'parts.*.z' => ['nullable', 'numeric', 'min:-50000', 'max:50000'],
            'parts.*.rotation' => ['nullable', 'numeric'],
            'parts.*.colour' => ['nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'parts.*.points' => ['required_if:parts.*.shape,sketch', 'array', 'min:3', 'max:500'],
            'parts.*.points.*.x' => ['required', 'numeric'],
            'parts.*.points.*.y' => ['required', 'numeric'],
        ];
    }

    /**
     * Fill a raw part list's optional fields and centre its sketches, the
     * way the browser designer's newSketchPart does, so every author
     * produces the same part.
     *
     * @param  array<int, array<string, mixed>>  $raw
     * @return array<int, array<string, mixed>>
     */
    public static function normaliseParts(array $raw): array
    {
        return array_values(array_map(function (array $part, int $index): array {
            $shape = $part['shape'];

            $normalised = [
                'id' => 'part-'.($index + 1),
                'name' => $part['name'] ?? ucfirst((string) $shape),
                'shape' => $shape,
                'width' => (float) ($part['width'] ?? 600),
                'depth' => (float) ($part['depth'] ?? 600),
                'height' => (float) $part['height'],
                'x' => (float) ($part['x'] ?? 0),
                'y' => (float) ($part['y'] ?? 0),
                'z' => (float) ($part['z'] ?? 0),
                'rotation' => (float) ($part['rotation'] ?? 0),
                // Lower-cased so the same material always compares equal,
                // whichever author wrote it.
                ...(isset($part['colour'])
                    ? ['colour' => mb_strtolower($part['colour'])]
                    : []),
            ];

            if ($shape !== 'sketch') {
                return $normalised;
            }

            $xs = array_map(fn (array $point): float => (float) $point['x'], $part['points']);
            $ys = array_map(fn (array $point): float => (float) $point['y'], $part['points']);
            $midX = (min($xs) + max($xs)) / 2;
            $midY = (min($ys) + max($ys)) / 2;

            $normalised['points'] = array_map(fn (array $point): array => [
                'x' => (float) $point['x'] - $midX,
                'y' => (float) $point['y'] - $midY,
            ], $part['points']);
            $normalised['width'] = max(1.0, max($xs) - min($xs));
            $normalised['depth'] = max(1.0, max($ys) - min($ys));

            return $normalised;
        }, $raw, array_keys($raw)));
    }

    /**
     * Compile a part list into the mesh a library payload stores.
     *
     * @param  array<int, array<string, mixed>>  $parts
     * @return array{vertices: array<int, float>, footprint: array<int, array{x: float, y: float}>, size: array{x: float, y: float, z: float}, triangleCount: int}
     */
    public function handle(array $parts): array
    {
        $vertices = [];

        foreach ($parts as $part) {
            $triangles = match ($part['shape']) {
                'box' => $this->boxTriangles($part),
                'cylinder' => $this->cylinderTriangles($part),
                'sketch' => $this->sketchTriangles($part),
                default => throw new InvalidArgumentException(
                    "Unknown part shape \"{$part['shape']}\". Use box, cylinder or sketch."
                ),
            };

            array_push($vertices, ...$triangles);
        }

        if ($vertices === []) {
            return [
                'vertices' => [],
                'footprint' => [],
                'size' => ['x' => 0.0, 'y' => 0.0, 'z' => 0.0],
                'triangleCount' => 0,
            ];
        }

        return $this->normalise($vertices);
    }

    /**
     * Re-centre the plan on the origin, sit the base at z zero, and measure.
     *
     * @param  array<int, float>  $vertices
     * @return array{vertices: array<int, float>, footprint: array<int, array{x: float, y: float}>, size: array{x: float, y: float, z: float}, triangleCount: int}
     */
    private function normalise(array $vertices): array
    {
        $min = [INF, INF, INF];
        $max = [-INF, -INF, -INF];

        foreach ($vertices as $index => $value) {
            $axis = $index % 3;
            $min[$axis] = min($min[$axis], $value);
            $max[$axis] = max($max[$axis], $value);
        }

        $shift = [
            -($min[0] + $max[0]) / 2,
            -($min[1] + $max[1]) / 2,
            -$min[2],
        ];

        $plan = [];

        foreach ($vertices as $index => $value) {
            $vertices[$index] = $value + $shift[$index % 3];

            if ($index % 3 === 0) {
                $plan[] = ['x' => $vertices[$index], 'y' => 0.0];
            } elseif ($index % 3 === 1) {
                $plan[count($plan) - 1]['y'] = $vertices[$index];
            }
        }

        return [
            'vertices' => $vertices,
            'footprint' => $this->convexHull($plan),
            'size' => [
                'x' => $max[0] - $min[0],
                'y' => $max[1] - $min[1],
                'z' => $max[2] - $min[2],
            ],
            'triangleCount' => intdiv(count($vertices), 9),
        ];
    }

    /* ------------------------------------------------------------- shapes */

    /**
     * @param  array<string, mixed>  $part
     * @return callable(float, float): array{float, float}
     */
    private function spin(array $part): callable
    {
        $radians = deg2rad((float) ($part['rotation'] ?? 0));
        $cos = cos($radians);
        $sin = sin($radians);
        $x = (float) ($part['x'] ?? 0);
        $y = (float) ($part['y'] ?? 0);

        return fn (float $px, float $py): array => [
            $x + $px * $cos - $py * $sin,
            $y + $px * $sin + $py * $cos,
        ];
    }

    /**
     * @param  array<string, mixed>  $part
     * @return array<int, float>
     */
    private function boxTriangles(array $part): array
    {
        $turn = $this->spin($part);
        $hw = ((float) $part['width']) / 2;
        $hd = ((float) $part['depth']) / 2;
        $z0 = (float) ($part['z'] ?? 0);
        $z1 = $z0 + (float) $part['height'];

        // The four plan corners, counter-clockwise seen from above.
        $corners = [
            $turn(-$hw, -$hd),
            $turn($hw, -$hd),
            $turn($hw, $hd),
            $turn(-$hw, $hd),
        ];

        $triangles = [];
        $quad = function (array $a, array $b, array $c, array $d) use (&$triangles): void {
            array_push($triangles, ...$a, ...$b, ...$c, ...$a, ...$c, ...$d);
        };

        $low = array_map(fn (array $corner): array => [$corner[0], $corner[1], $z0], $corners);
        $high = array_map(fn (array $corner): array => [$corner[0], $corner[1], $z1], $corners);

        // Top faces up, bottom faces down, and each side winds outward.
        $quad($high[0], $high[1], $high[2], $high[3]);
        $quad($low[3], $low[2], $low[1], $low[0]);

        for ($side = 0; $side < 4; $side++) {
            $next = ($side + 1) % 4;
            $quad($low[$side], $low[$next], $high[$next], $high[$side]);
        }

        return $triangles;
    }

    /**
     * @param  array<string, mixed>  $part
     * @return array<int, float>
     */
    private function cylinderTriangles(array $part): array
    {
        $turn = $this->spin($part);
        $rx = ((float) $part['width']) / 2;
        $ry = ((float) $part['depth']) / 2;
        $z0 = (float) ($part['z'] ?? 0);
        $z1 = $z0 + (float) $part['height'];

        $ring = [];

        for ($segment = 0; $segment < self::CYLINDER_SEGMENTS; $segment++) {
            $angle = ($segment / self::CYLINDER_SEGMENTS) * M_PI * 2;
            $ring[] = $turn(cos($angle) * $rx, sin($angle) * $ry);
        }

        $centre = $turn(0, 0);
        $triangles = [];

        for ($segment = 0; $segment < self::CYLINDER_SEGMENTS; $segment++) {
            [$ax, $ay] = $ring[$segment];
            [$bx, $by] = $ring[($segment + 1) % self::CYLINDER_SEGMENTS];

            // Caps: a fan from the centre, top up and bottom down.
            array_push($triangles, $centre[0], $centre[1], $z1, $ax, $ay, $z1, $bx, $by, $z1);
            array_push($triangles, $centre[0], $centre[1], $z0, $bx, $by, $z0, $ax, $ay, $z0);

            // The side, wound outward.
            array_push($triangles, $ax, $ay, $z0, $bx, $by, $z0, $bx, $by, $z1);
            array_push($triangles, $ax, $ay, $z0, $bx, $by, $z1, $ax, $ay, $z1);
        }

        return $triangles;
    }

    /**
     * @param  array<string, mixed>  $part
     * @return array<int, float>
     */
    private function sketchTriangles(array $part): array
    {
        /** @var array<int, array{x: float, y: float}> $outline */
        $outline = array_map(
            fn (array $point): array => ['x' => (float) $point['x'], 'y' => (float) $point['y']],
            $part['points'] ?? [],
        );

        $ears = $this->triangulate($outline);

        if ($ears === []) {
            return [];
        }

        $turn = $this->spin($part);
        $z0 = (float) ($part['z'] ?? 0);
        $z1 = $z0 + (float) $part['height'];

        $area = 0.0;
        $count = count($outline);

        for ($index = 0; $index < $count; $index++) {
            $a = $outline[$index];
            $b = $outline[($index + 1) % $count];
            $area += $a['x'] * $b['y'] - $b['x'] * $a['y'];
        }

        $ring = $area < 0 ? array_reverse($outline) : $outline;
        $placed = array_map(fn (array $point): array => $turn($point['x'], $point['y']), $ring);

        $triangles = [];

        foreach ($ears as [$a, $b, $c]) {
            [$ax, $ay] = $turn($outline[$a]['x'], $outline[$a]['y']);
            [$bx, $by] = $turn($outline[$b]['x'], $outline[$b]['y']);
            [$cx, $cy] = $turn($outline[$c]['x'], $outline[$c]['y']);

            // Top faces up; the bottom is the same fan reversed.
            array_push($triangles, $ax, $ay, $z1, $bx, $by, $z1, $cx, $cy, $z1);
            array_push($triangles, $ax, $ay, $z0, $cx, $cy, $z0, $bx, $by, $z0);
        }

        $sides = count($placed);

        for ($index = 0; $index < $sides; $index++) {
            [$ax, $ay] = $placed[$index];
            [$bx, $by] = $placed[($index + 1) % $sides];

            array_push($triangles, $ax, $ay, $z0, $bx, $by, $z0, $bx, $by, $z1);
            array_push($triangles, $ax, $ay, $z0, $bx, $by, $z1, $ax, $ay, $z1);
        }

        return $triangles;
    }

    /* ----------------------------------------------------------- geometry */

    /**
     * Ear-clip a simple polygon into counter-clockwise index triples.
     *
     * @param  array<int, array{x: float, y: float}>  $points
     * @return array<int, array{int, int, int}>
     */
    private function triangulate(array $points): array
    {
        $count = count($points);

        if ($count < 3) {
            return [];
        }

        $area = 0.0;

        for ($index = 0; $index < $count; $index++) {
            $a = $points[$index];
            $b = $points[($index + 1) % $count];
            $area += $a['x'] * $b['y'] - $b['x'] * $a['y'];
        }

        $ring = range(0, $count - 1);

        if ($area < 0) {
            $ring = array_reverse($ring);
        }

        $ears = [];
        $guard = $count * $count + 10;

        while (count($ring) > 3 && $guard-- > 0) {
            $clipped = false;
            $size = count($ring);

            for ($at = 0; $at < $size; $at++) {
                $prev = $ring[($at - 1 + $size) % $size];
                $here = $ring[$at];
                $next = $ring[($at + 1) % $size];
                $a = $points[$prev];
                $b = $points[$here];
                $c = $points[$next];

                $cross = ($b['x'] - $a['x']) * ($c['y'] - $a['y'])
                    - ($c['x'] - $a['x']) * ($b['y'] - $a['y']);

                // A reflex corner is not an ear.
                if ($cross <= 0) {
                    continue;
                }

                $blocked = false;

                foreach ($ring as $other) {
                    if ($other === $prev || $other === $here || $other === $next) {
                        continue;
                    }

                    if ($this->pointInTriangle($points[$other], $a, $b, $c)) {
                        $blocked = true;
                        break;
                    }
                }

                if ($blocked) {
                    continue;
                }

                $ears[] = [$prev, $here, $next];
                array_splice($ring, $at, 1);
                $clipped = true;
                break;
            }

            if (! $clipped) {
                break;
            }
        }

        if (count($ring) === 3) {
            $ears[] = [$ring[0], $ring[1], $ring[2]];
        }

        return $ears;
    }

    /**
     * @param  array{x: float, y: float}  $p
     * @param  array{x: float, y: float}  $a
     * @param  array{x: float, y: float}  $b
     * @param  array{x: float, y: float}  $c
     */
    private function pointInTriangle(array $p, array $a, array $b, array $c): bool
    {
        $sign = fn (array $u, array $v, array $w): float => ($v['x'] - $u['x']) * ($w['y'] - $u['y'])
            - ($w['x'] - $u['x']) * ($v['y'] - $u['y']);

        $first = $sign($a, $b, $p);
        $second = $sign($b, $c, $p);
        $third = $sign($c, $a, $p);

        $anyNegative = $first < 0 || $second < 0 || $third < 0;
        $anyPositive = $first > 0 || $second > 0 || $third > 0;

        return ! ($anyNegative && $anyPositive);
    }

    /**
     * Convex hull by monotone chain, the plan silhouette the editor picks by.
     *
     * @param  array<int, array{x: float, y: float}>  $points
     * @return array<int, array{x: float, y: float}>
     */
    private function convexHull(array $points): array
    {
        $unique = array_values(array_unique(array_map(
            fn (array $point): string => round($point['x'], 3).','.round($point['y'], 3),
            $points,
        )));

        $points = array_map(function (string $key): array {
            [$x, $y] = explode(',', $key);

            return ['x' => (float) $x, 'y' => (float) $y];
        }, $unique);

        if (count($points) < 3) {
            return $points;
        }

        usort($points, fn (array $a, array $b): int => $a['x'] <=> $b['x'] ?: $a['y'] <=> $b['y']);

        $cross = fn (array $o, array $a, array $b): float => ($a['x'] - $o['x']) * ($b['y'] - $o['y'])
            - ($a['y'] - $o['y']) * ($b['x'] - $o['x']);

        $lower = [];

        foreach ($points as $point) {
            while (count($lower) >= 2 && $cross($lower[count($lower) - 2], $lower[count($lower) - 1], $point) <= 0) {
                array_pop($lower);
            }

            $lower[] = $point;
        }

        $upper = [];

        foreach (array_reverse($points) as $point) {
            while (count($upper) >= 2 && $cross($upper[count($upper) - 2], $upper[count($upper) - 1], $point) <= 0) {
                array_pop($upper);
            }

            $upper[] = $point;
        }

        array_pop($lower);
        array_pop($upper);

        return array_values([...$lower, ...$upper]);
    }
}
