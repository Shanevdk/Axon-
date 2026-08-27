<?php

namespace App\Actions\Library;

/**
 * The server-side twin of `itemSnapshot()` in `resources/js/lib/cad/library.ts`:
 * the same fixed camera, the same culling and shading, the same SVG — so an
 * item designed by an AI over MCP gets the same picture one designed in the
 * browser does. Change them together.
 */
class DrawItemSnapshot
{
    private const FACE_LIMIT = 1500;

    private const AZIMUTH = -M_PI / 4;

    private const ELEVATION = M_PI / 6.5;

    /**
     * Draw a mesh as a small shaded SVG data URL.
     *
     * @param  array<int, float>  $vertices
     */
    public function handle(array $vertices): string
    {
        $cosA = cos(self::AZIMUTH);
        $sinA = sin(self::AZIMUTH);
        $cosE = cos(self::ELEVATION);
        $sinE = sin(self::ELEVATION);

        // Light from the upper left, fixed, so every thumbnail matches.
        $light = $this->unit([-0.45, 0.35, 0.82]);
        $toCamera = [$sinA * $cosE, $cosA * $cosE, $sinE];

        $faces = [];
        $count = count($vertices);

        for ($index = 0; $index + 8 < $count; $index += 9) {
            $corners = [];
            $depth = 0.0;

            for ($corner = 0; $corner < 3; $corner++) {
                $x = $vertices[$index + $corner * 3];
                $y = $vertices[$index + $corner * 3 + 1];
                $z = $vertices[$index + $corner * 3 + 2];

                // Rotate the plan under the camera, then tilt.
                $px = $x * $cosA - $y * $sinA;
                $py = $x * $sinA + $y * $cosA;

                $corners[] = [$px, -($z * $cosE - $py * $sinE)];
                $depth += $py * $cosE + $z * $sinE;
            }

            $normal = $this->normal($vertices, $index);

            // Faces looking away are never seen under a fixed camera.
            if ($this->dot($normal, $toCamera) <= 0) {
                continue;
            }

            $faces[] = [
                'points' => $corners,
                'depth' => $depth / 3,
                'shade' => max(0.25, $this->dot($normal, $light)),
                'area' => $this->area($corners),
            ];
        }

        if ($faces === []) {
            return $this->wrap('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>');
        }

        usort($faces, fn (array $a, array $b): int => $b['area'] <=> $a['area']);
        $faces = array_slice($faces, 0, self::FACE_LIMIT);
        usort($faces, fn (array $a, array $b): int => $a['depth'] <=> $b['depth']);

        $minX = INF;
        $minY = INF;
        $maxX = -INF;
        $maxY = -INF;

        foreach ($faces as $face) {
            foreach ($face['points'] as [$x, $y]) {
                $minX = min($minX, $x);
                $minY = min($minY, $y);
                $maxX = max($maxX, $x);
                $maxY = max($maxY, $y);
            }
        }

        $width = max(1, $maxX - $minX);
        $height = max(1, $maxY - $minY);
        $margin = max($width, $height) * 0.06;

        $polygons = '';

        foreach ($faces as $face) {
            $tone = (int) round(48 + $face['shade'] * 168);
            $points = implode(' ', array_map(
                fn (array $point): string => sprintf('%.1f,%.1f', $point[0] - $minX, $point[1] - $minY),
                $face['points'],
            ));

            $polygons .= sprintf('<polygon points="%s" fill="rgb(%d,%d,%d)"/>', $points, $tone, $tone, $tone);
        }

        $svg = sprintf(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.1f %.1f %.1f %.1f">%s</svg>',
            -$margin,
            -$margin,
            $width + $margin * 2,
            $height + $margin * 2,
            $polygons,
        );

        return $this->wrap($svg);
    }

    private function wrap(string $svg): string
    {
        return 'data:image/svg+xml;charset=utf-8,'.rawurlencode($svg);
    }

    /**
     * @param  array<int, float>  $vertices
     * @return array{float, float, float}
     */
    private function normal(array $vertices, int $index): array
    {
        $ax = $vertices[$index];
        $ay = $vertices[$index + 1];
        $az = $vertices[$index + 2];
        $u = [
            $vertices[$index + 3] - $ax,
            $vertices[$index + 4] - $ay,
            $vertices[$index + 5] - $az,
        ];
        $v = [
            $vertices[$index + 6] - $ax,
            $vertices[$index + 7] - $ay,
            $vertices[$index + 8] - $az,
        ];

        return $this->unit([
            $u[1] * $v[2] - $u[2] * $v[1],
            $u[2] * $v[0] - $u[0] * $v[2],
            $u[0] * $v[1] - $u[1] * $v[0],
        ]);
    }

    /**
     * @param  array<int, float>  $vector
     * @return array{float, float, float}
     */
    private function unit(array $vector): array
    {
        $length = sqrt($vector[0] ** 2 + $vector[1] ** 2 + $vector[2] ** 2) ?: 1.0;

        return [$vector[0] / $length, $vector[1] / $length, $vector[2] / $length];
    }

    /**
     * @param  array<int, float>  $a
     * @param  array<int, float>  $b
     */
    private function dot(array $a, array $b): float
    {
        return $a[0] * $b[0] + $a[1] * $b[1] + $a[2] * $b[2];
    }

    /**
     * @param  array<int, array<int, float>>  $points
     */
    private function area(array $points): float
    {
        [$a, $b, $c] = $points;

        return abs(
            ($b[0] - $a[0]) * ($c[1] - $a[1]) - ($c[0] - $a[0]) * ($b[1] - $a[1]),
        ) / 2;
    }
}
