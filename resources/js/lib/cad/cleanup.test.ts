import { describe, expect, it } from 'vitest';
import { cleanUpDocument, WELD_TOLERANCE } from '@/lib/cad/cleanup';
import { maxOpeningWidth } from '@/lib/cad/model';
import type {
    CadDocument,
    DoorElement,
    MeshElement,
    WallElement,
} from '@/lib/cad/types';

function baseDocument(): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [{ id: 'level-1', name: 'Level 1', elevation: 0 }],
        wallTypes: [
            {
                id: 'generic-200',
                name: 'Generic - 200mm',
                thickness: 200,
                function: 'exterior',
            },
        ],
        doorTypes: [
            {
                id: 'door-915',
                name: 'Single-Flush 915 x 2134',
                width: 915,
                height: 2134,
                leaves: 1,
            },
        ],
        windowTypes: [],
        elements: [],
        viewSettings: {},
    };
}

function wall(
    id: string,
    a: { x: number; y: number },
    b: { x: number; y: number },
    overrides: Partial<WallElement> = {},
): WallElement {
    return {
        id,
        kind: 'wall',
        level: 'level-1',
        typeId: 'generic-200',
        a,
        b,
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
        ...overrides,
    };
}

function door(id: string, host: string, t = 0.5): DoorElement {
    return {
        id,
        kind: 'door',
        level: 'level-1',
        typeId: 'door-915',
        host,
        t,
        flipFace: false,
        flipHand: false,
    };
}

function wallsOf(document: CadDocument): WallElement[] {
    return document.elements.filter(
        (element): element is WallElement => element.kind === 'wall',
    );
}

describe('cleanUpDocument', () => {
    it('leaves a clean model exactly alone', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 6000, y: 0 }),
            wall('wall-2', { x: 6000, y: 0 }, { x: 6000, y: 4000 }),
            door('door-1', 'wall-1'),
        ];

        const report = cleanUpDocument(document);

        expect(report.changed).toBe(0);
        expect(report.fixes).toEqual([]);
        expect(report.document.elements).toEqual(document.elements);
    });

    it('closes a corner two walls almost meet at', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 5990, y: 8 }),
            wall('wall-2', { x: 6006, y: -6 }, { x: 6000, y: 4000 }),
        ];

        const report = cleanUpDocument(document);
        const [first, second] = wallsOf(report.document);

        expect(report.changed).toBeGreaterThan(0);
        expect(first.b).toEqual(second.a);
    });

    it('leaves a genuine gap alone', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 5000, y: 0 }),
            wall(
                'wall-2',
                { x: 5000 + WELD_TOLERANCE * 3, y: 0 },
                { x: 9000, y: 0 },
            ),
        ];

        const report = cleanUpDocument(document);
        const [first, second] = wallsOf(report.document);

        expect(first.b.x).toBe(5000);
        expect(second.a.x).toBe(5000 + WELD_TOLERANCE * 3);
    });

    it('welds toward a pinned wall rather than moving it', () => {
        const document = baseDocument();
        document.elements = [
            wall('held', { x: 0, y: 0 }, { x: 6000, y: 0 }, { pinned: true }),
            wall('loose', { x: 6012, y: 9 }, { x: 6000, y: 4000 }),
        ];

        const report = cleanUpDocument(document);
        const [held, loose] = wallsOf(report.document);

        expect(held.b).toEqual({ x: 6000, y: 0 });
        expect(loose.a).toEqual({ x: 6000, y: 0 });
    });

    it('squares a wall a few millimetres off axis, meeting in the middle', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 6000, y: 16 }),
        ];

        const report = cleanUpDocument(document);
        const [squared] = wallsOf(report.document);

        expect(squared.a.y).toBe(8);
        expect(squared.b.y).toBe(8);
    });

    it('respects a wall drawn at a deliberate angle', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 4000, y: 4000 }),
        ];

        expect(cleanUpDocument(document).changed).toBe(0);
    });

    it('removes a sliver wall and whatever was hosted on it', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 6000, y: 0 }),
            wall('stub', { x: 9000, y: 9000 }, { x: 9004, y: 9000 }),
            door('door-1', 'stub'),
        ];

        const report = cleanUpDocument(document);

        expect(report.document.elements.map((element) => element.id)).toEqual([
            'wall-1',
        ]);
    });

    it('merges a wall drawn twice and rehosts its door on the survivor', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 6000, y: 0 }),
            // The same run drawn again the other way, carrying a door at 0.3.
            wall('wall-2', { x: 6000, y: 0 }, { x: 0, y: 0 }),
            door('door-1', 'wall-2', 0.3),
        ];

        const report = cleanUpDocument(document);
        const kept = wallsOf(report.document);
        const rehomed = report.document.elements.find(
            (element): element is DoorElement => element.kind === 'door',
        );

        expect(kept).toHaveLength(1);
        expect(kept[0].id).toBe('wall-1');
        expect(rehomed?.host).toBe('wall-1');
        // Reversed host, mirrored position.
        expect(rehomed?.t).toBeCloseTo(0.7);
    });

    it('shrinks an opening its wall cannot carry back inside it', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 1000, y: 0 }),
            { ...door('door-1', 'wall-1'), width: 2000 },
        ];

        const report = cleanUpDocument(document);
        const fitted = report.document.elements.find(
            (element): element is DoorElement => element.kind === 'door',
        );

        expect(fitted?.width).toBe(maxOpeningWidth(1000));
    });

    it('removes a door whose wall has gone', () => {
        const document = baseDocument();
        document.elements = [door('door-1', 'vanished')];

        const report = cleanUpDocument(document);

        expect(report.document.elements).toHaveLength(0);
        expect(report.fixes.join(' ')).toContain('orphaned');
    });

    it('drops broken triangles from an imported model and keeps the rest', () => {
        const mesh: MeshElement = {
            id: 'mesh-1',
            kind: 'mesh',
            level: 'level-1',
            name: 'Scan',
            p: { x: 0, y: 0 },
            rotation: 0,
            scale: 1,
            baseOffset: 0,
            vertices: [
                // A sound triangle…
                0,
                0,
                0,
                1000,
                0,
                0,
                0,
                1000,
                0,
                // …a zero-area one…
                0,
                0,
                0,
                500,
                0,
                0,
                1000,
                0,
                0,
                // …and one carrying a broken number.
                0,
                0,
                0,
                Number.NaN,
                0,
                0,
                0,
                500,
                0,
            ],
            footprint: [
                { x: 0, y: 0 },
                { x: 1000, y: 0 },
                { x: 0, y: 1000 },
            ],
            size: { x: 1000, y: 1000, z: 0 },
        };

        const document = baseDocument();
        document.elements = [mesh];

        const report = cleanUpDocument(document);
        const polished = report.document.elements[0] as MeshElement;

        expect(polished.vertices).toHaveLength(9);
        expect(report.fixes.join(' ')).toContain('2 broken triangles');
    });

    it('never touches anything pinned', () => {
        const document = baseDocument();
        document.elements = [
            wall('stub', { x: 0, y: 0 }, { x: 4, y: 0 }, { pinned: true }),
            wall(
                'crooked',
                { x: 100, y: 100 },
                { x: 6100, y: 112 },
                { pinned: true },
            ),
            { ...door('door-1', 'vanished'), pinned: true },
        ];

        const report = cleanUpDocument(document);

        expect(report.changed).toBe(0);
        expect(report.document.elements).toEqual(document.elements);
    });

    it('running it twice changes nothing more', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 0, y: 0 }, { x: 5992, y: 7 }),
            wall('wall-2', { x: 6005, y: -4 }, { x: 6000, y: 4000 }),
            wall('stub', { x: 9000, y: 9000 }, { x: 9003, y: 9000 }),
        ];

        const once = cleanUpDocument(document);
        const twice = cleanUpDocument(once.document);

        expect(once.changed).toBeGreaterThan(0);
        expect(twice.changed).toBe(0);
    });
});
