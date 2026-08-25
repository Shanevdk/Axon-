import type { CadDocument, CadElement } from '@/lib/cad/types';

/**
 * A small but complete model used across the exchange tests: a 6 × 4 m shell
 * with one partition, a door, a window, a slab, a room tag and a column.
 */
export function testDocument(
    overrides: Partial<CadDocument> = {},
): CadDocument {
    const corners = [
        [0, 0],
        [6000, 0],
        [6000, 4000],
        [0, 4000],
    ];

    const shell: CadElement[] = corners.map((corner, index) => {
        const next = corners[(index + 1) % corners.length];

        return {
            id: `shell-${index + 1}`,
            kind: 'wall',
            level: 'level-1',
            typeId: 'ext-300',
            a: { x: corner[0], y: corner[1] },
            b: { x: next[0], y: next[1] },
            height: 3000,
            baseOffset: 0,
            locationLine: 'center',
        };
    });

    return {
        version: 1,
        units: 'metric',
        levels: [
            { id: 'level-1', name: 'Level 1', elevation: 0 },
            { id: 'level-2', name: 'Level 2', elevation: 3000 },
        ],
        wallTypes: [
            {
                id: 'ext-300',
                name: 'Exterior - 300',
                thickness: 300,
                function: 'exterior',
            },
            {
                id: 'int-100',
                name: 'Interior - 100',
                thickness: 100,
                function: 'interior',
            },
        ],
        doorTypes: [
            {
                id: 'door-900',
                name: 'Single 900',
                width: 900,
                height: 2100,
                leaves: 1,
            },
        ],
        windowTypes: [
            {
                id: 'win-1200',
                name: 'Fixed 1200',
                width: 1200,
                height: 1200,
                sillHeight: 900,
            },
        ],
        elements: [
            ...shell,
            {
                id: 'part-1',
                kind: 'wall',
                level: 'level-1',
                typeId: 'int-100',
                a: { x: 3000, y: 0 },
                b: { x: 3000, y: 4000 },
                height: 2700,
                baseOffset: 0,
                locationLine: 'center',
            },
            {
                id: 'door-1',
                kind: 'door',
                level: 'level-1',
                typeId: 'door-900',
                host: 'part-1',
                t: 0.5,
                flipFace: false,
                flipHand: false,
            },
            {
                id: 'window-1',
                kind: 'window',
                level: 'level-1',
                typeId: 'win-1200',
                host: 'shell-1',
                t: 0.5,
                flipFace: false,
                flipHand: false,
            },
            {
                id: 'slab-1',
                kind: 'floor',
                level: 'level-1',
                thickness: 200,
                offset: 0,
                points: [
                    { x: -150, y: -150 },
                    { x: 6150, y: -150 },
                    { x: 6150, y: 4150 },
                    { x: -150, y: 4150 },
                ],
            },
            {
                id: 'column-1',
                kind: 'column',
                level: 'level-1',
                p: { x: 1500, y: 2000 },
                size: 400,
                rotation: 0,
                height: 3000,
            },
            {
                id: 'room-1',
                kind: 'room',
                level: 'level-1',
                name: 'Living',
                number: '101',
                p: { x: 1500, y: 1000 },
            },
        ],
        viewSettings: {},
        ...overrides,
    };
}

/** A unit cube as a flat triangle list, for exercising the mesh importers. */
export function cubeTriangles(size = 1000): number[] {
    const h = size / 2;
    const corners = [
        [-h, -h, 0],
        [h, -h, 0],
        [h, h, 0],
        [-h, h, 0],
        [-h, -h, size],
        [h, -h, size],
        [h, h, size],
        [-h, h, size],
    ];

    const quads: [number, number, number, number][] = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ];

    return quads.flatMap(([a, b, c, d]) =>
        [
            [a, b, c],
            [a, c, d],
        ].flatMap((triangle) => triangle.flatMap((index) => corners[index])),
    );
}
