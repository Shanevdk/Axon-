<?php

namespace App\Actions\Projects;

use stdClass;

/**
 * Builds the model document a new project opens with.
 *
 * Every length in the document is stored in millimetres regardless of the
 * project's display units, mirroring the way Revit keeps a single internal
 * unit and only formats values on the way out.
 */
class BuildStarterDocument
{
    /**
     * Level elevations in millimetres.
     */
    private const LEVELS = [
        ['id' => 'level-1', 'name' => 'Level 1', 'elevation' => 0],
        ['id' => 'level-2', 'name' => 'Level 2', 'elevation' => 3000],
        ['id' => 'roof', 'name' => 'Roof', 'elevation' => 6000],
    ];

    /**
     * Build an empty, fully configured document.
     *
     * @return array<string, mixed>
     */
    public function empty(string $units = 'metric'): array
    {
        return [
            'version' => 1,
            'units' => $units,
            'levels' => self::LEVELS,
            'wallTypes' => $this->wallTypes(),
            'viewTemplates' => [],
            'doorTypes' => $this->doorTypes(),
            'windowTypes' => $this->windowTypes(),
            'elements' => [],
            'viewSettings' => new stdClass,
        ];
    }

    /**
     * Backfill anything a stored document is missing.
     *
     * The autosave endpoint only insists on levels and elements, so a partial
     * or externally produced document can reach the database. The editor
     * assumes the type catalogues exist, so they are healed here on the way
     * out rather than crashing the client.
     *
     * @param  array<string, mixed>  $document
     * @return array<string, mixed>
     */
    public function normalize(array $document): array
    {
        $units = in_array($document['units'] ?? null, ['metric', 'imperial'], true)
            ? $document['units']
            : 'metric';

        $defaults = $this->empty($units);

        foreach (['levels', 'wallTypes', 'doorTypes', 'windowTypes'] as $catalogue) {
            if (empty($document[$catalogue]) || ! is_array($document[$catalogue])) {
                $document[$catalogue] = $defaults[$catalogue];
            }
        }

        $document['version'] ??= 1;
        $document['units'] = $units;
        $document['elements'] = is_array($document['elements'] ?? null)
            ? $document['elements']
            : [];

        if (! is_array($document['viewTemplates'] ?? null)) {
            $document['viewTemplates'] = [];
        }

        if (empty($document['viewSettings']) || ! is_array($document['viewSettings'])) {
            $document['viewSettings'] = new stdClass;
        }

        return $document;
    }

    /**
     * Build a document pre-populated with a small single storey residence.
     *
     * @return array<string, mixed>
     */
    public function sampleResidence(string $units = 'metric'): array
    {
        $document = $this->empty($units);

        $document['elements'] = [
            ...$this->shell(),
            ...$this->partitions(),
            ...$this->openings(),
            ...$this->rooms(),
            $this->slab(),
        ];

        return $document;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function wallTypes(): array
    {
        return [
            ['id' => 'ext-brick', 'name' => 'Exterior - Brick on Stud', 'thickness' => 302, 'function' => 'exterior', 'construction' => 'wood'],
            ['id' => 'ext-concrete', 'name' => 'Exterior - 300 Concrete', 'thickness' => 300, 'function' => 'exterior', 'construction' => 'concrete'],
            ['id' => 'generic-200', 'name' => 'Generic - 200mm', 'thickness' => 200, 'function' => 'interior', 'construction' => 'wood'],
            ['id' => 'int-partition', 'name' => 'Interior - 92mm Partition', 'thickness' => 92, 'function' => 'interior', 'construction' => 'wood'],
            ['id' => 'int-service', 'name' => 'Interior - 152mm Service', 'thickness' => 152, 'function' => 'interior', 'construction' => 'wood'],
            ['id' => 'curtain-storefront', 'name' => 'Curtain Wall - Storefront', 'thickness' => 150, 'function' => 'curtain', 'construction' => 'glazed'],
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function doorTypes(): array
    {
        return [
            ['id' => 'door-single-915', 'name' => 'Single-Flush 915 x 2134', 'width' => 915, 'height' => 2134, 'leaves' => 1],
            ['id' => 'door-single-815', 'name' => 'Single-Flush 815 x 2134', 'width' => 815, 'height' => 2134, 'leaves' => 1],
            ['id' => 'door-double-1830', 'name' => 'Double-Glass 1830 x 2134', 'width' => 1830, 'height' => 2134, 'leaves' => 2],
            ['id' => 'door-slider-2400', 'name' => 'Sliding Patio 2400 x 2134', 'width' => 2400, 'height' => 2134, 'leaves' => 2],
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function windowTypes(): array
    {
        return [
            ['id' => 'win-fixed-900', 'name' => 'Fixed 900 x 1200', 'width' => 900, 'height' => 1200, 'sillHeight' => 900],
            ['id' => 'win-casement-600', 'name' => 'Casement 600 x 1500', 'width' => 600, 'height' => 1500, 'sillHeight' => 800],
            ['id' => 'win-slider-1800', 'name' => 'Slider 1800 x 1200', 'width' => 1800, 'height' => 1200, 'sillHeight' => 900],
            ['id' => 'win-picture-2400', 'name' => 'Picture 2400 x 1500', 'width' => 2400, 'height' => 1500, 'sillHeight' => 750],
        ];
    }

    /**
     * The four exterior walls of the sample residence.
     *
     * @return array<int, array<string, mixed>>
     */
    private function shell(): array
    {
        $corners = [[0, 0], [12000, 0], [12000, 9000], [0, 9000]];

        return array_map(function (int $index) use ($corners): array {
            [$ax, $ay] = $corners[$index];
            [$bx, $by] = $corners[($index + 1) % 4];

            return $this->wall('shell-'.($index + 1), 'ext-brick', $ax, $ay, $bx, $by, 3000);
        }, [0, 1, 2, 3]);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function partitions(): array
    {
        return [
            $this->wall('part-1', 'int-partition', 7000, 0, 7000, 9000, 2700),
            $this->wall('part-2', 'int-partition', 7000, 5000, 12000, 5000, 2700),
            $this->wall('part-3', 'int-service', 0, 5000, 3000, 5000, 2700),
            $this->wall('part-4', 'int-partition', 3000, 5000, 3000, 9000, 2700),
            $this->wall('part-5', 'int-partition', 3000, 5000, 7000, 5000, 2700),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function openings(): array
    {
        return [
            $this->opening('door', 'op-1', 'door-double-1830', 'shell-1', 0.28),
            $this->opening('window', 'op-2', 'win-picture-2400', 'shell-1', 0.62),
            $this->opening('window', 'op-3', 'win-fixed-900', 'shell-1', 0.88),
            $this->opening('window', 'op-4', 'win-slider-1800', 'shell-2', 0.24),
            $this->opening('window', 'op-5', 'win-fixed-900', 'shell-2', 0.72),
            $this->opening('window', 'op-6', 'win-casement-600', 'shell-3', 0.22),
            $this->opening('window', 'op-7', 'win-slider-1800', 'shell-3', 0.55),
            $this->opening('window', 'op-8', 'win-fixed-900', 'shell-3', 0.82),
            $this->opening('window', 'op-9', 'win-casement-600', 'shell-4', 0.45),
            $this->opening('door', 'op-10', 'door-single-915', 'part-1', 0.22),
            $this->opening('door', 'op-11', 'door-single-915', 'part-1', 0.72),
            $this->opening('door', 'op-12', 'door-single-815', 'part-2', 0.45),
            $this->opening('door', 'op-13', 'door-single-815', 'part-4', 0.55),
            $this->opening('door', 'op-14', 'door-double-1830', 'part-5', 0.62),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function rooms(): array
    {
        $rooms = [
            ['room-1', '101', 'Living', 4200, 2400],
            ['room-2', '102', 'Kitchen', 1400, 7200],
            ['room-3', '103', 'Dining', 5200, 7200],
            ['room-4', '104', 'Primary Bedroom', 9500, 2400],
            ['room-5', '105', 'Bedroom 2', 9500, 7200],
        ];

        return array_map(fn (array $room): array => [
            'id' => $room[0],
            'kind' => 'room',
            'level' => 'level-1',
            'number' => $room[1],
            'name' => $room[2],
            'p' => ['x' => $room[3], 'y' => $room[4]],
        ], $rooms);
    }

    /**
     * @return array<string, mixed>
     */
    private function slab(): array
    {
        return [
            'id' => 'slab-1',
            'kind' => 'floor',
            'level' => 'level-1',
            'thickness' => 300,
            'offset' => 0,
            'points' => [
                ['x' => -151, 'y' => -151],
                ['x' => 12151, 'y' => -151],
                ['x' => 12151, 'y' => 9151],
                ['x' => -151, 'y' => 9151],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function wall(string $id, string $typeId, int $ax, int $ay, int $bx, int $by, int $height): array
    {
        return [
            'id' => $id,
            'kind' => 'wall',
            'level' => 'level-1',
            'typeId' => $typeId,
            'a' => ['x' => $ax, 'y' => $ay],
            'b' => ['x' => $bx, 'y' => $by],
            'height' => $height,
            'baseOffset' => 0,
            'locationLine' => 'center',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function opening(string $kind, string $id, string $typeId, string $host, float $t): array
    {
        return [
            'id' => $id,
            'kind' => $kind,
            'level' => 'level-1',
            'typeId' => $typeId,
            'host' => $host,
            't' => $t,
            'flipFace' => false,
            'flipHand' => false,
        ];
    }
}
