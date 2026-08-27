import { describe, expect, it } from 'vitest';
import { purgeUnusedTypes, reviewDocument } from '@/lib/cad/checkup';
import type {
    CadDocument,
    DoorElement,
    RoomElement,
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
            {
                id: 'unused-wall',
                name: 'Unused Wall',
                thickness: 100,
                function: 'interior',
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
            {
                id: 'unused-door',
                name: 'Unused Door',
                width: 800,
                height: 2100,
                leaves: 1,
            },
        ],
        windowTypes: [
            {
                id: 'window-1200',
                name: 'Fixed 1200 x 1500',
                width: 1200,
                height: 1500,
                sillHeight: 900,
            },
        ],
        elements: [],
        viewSettings: {},
    };
}

function wall(id: string, to = { x: 6000, y: 0 }): WallElement {
    return {
        id,
        kind: 'wall',
        level: 'level-1',
        typeId: 'generic-200',
        a: { x: 0, y: 0 },
        b: to,
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
    };
}

function door(id: string, host: string): DoorElement {
    return {
        id,
        kind: 'door',
        level: 'level-1',
        typeId: 'door-915',
        host,
        t: 0.5,
        flipFace: false,
        flipHand: false,
    };
}

describe('reviewDocument', () => {
    it('has nothing to say about a healthy model', () => {
        const document = baseDocument();
        document.elements = [wall('wall-1'), door('door-1', 'wall-1')];

        expect(reviewDocument(document)).toHaveLength(0);
    });

    it('reports a door whose wall has gone, as an error, first', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 5, y: 0 }), // also a degenerate-wall warning
            door('door-1', 'vanished'),
        ];

        const warnings = reviewDocument(document);

        expect(warnings.length).toBeGreaterThanOrEqual(2);
        expect(warnings[0].severity).toBe('error');
        expect(warnings[0].message).toContain('lost the wall');
        expect(warnings[0].elementIds).toEqual(['door-1']);
    });

    it('reports an opening its wall cannot carry, naming both', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', { x: 1000, y: 0 }),
            { ...door('door-1', 'wall-1'), width: 2000 },
        ];

        const [warning] = reviewDocument(document);

        expect(warning.message).toContain('2000 mm wide');
        expect(warning.elementIds).toEqual(['door-1', 'wall-1']);
    });

    it('reports elements stranded on a deleted level', () => {
        const document = baseDocument();
        document.elements = [{ ...wall('wall-1'), level: 'gone' }];

        const [warning] = reviewDocument(document);

        expect(warning.severity).toBe('error');
        expect(warning.message).toContain('level that no longer exists');
    });

    it('reports a type reference drawn with a stand-in', () => {
        const document = baseDocument();
        document.elements = [{ ...wall('wall-1'), typeId: 'retired-type' }];

        const [warning] = reviewDocument(document);

        expect(warning.message).toContain('stand-in');
    });

    it('reports rooms sharing a number and marks sharing a value', () => {
        const document = baseDocument();
        const room = (id: string, number: string): RoomElement => ({
            id,
            kind: 'room',
            level: 'level-1',
            p: { x: 0, y: 0 },
            name: 'Room',
            number,
        });

        document.elements = [
            room('room-1', '101'),
            room('room-2', '101'),
            { ...wall('wall-1'), mark: 'W1' },
            { ...wall('wall-2', { x: 0, y: 6000 }), mark: 'W1' },
        ];

        const messages = reviewDocument(document).map(
            (warning) => warning.message,
        );

        expect(messages).toContainEqual(
            expect.stringContaining('share the number 101'),
        );
        expect(messages).toContainEqual(
            expect.stringContaining('share the Mark W1'),
        );
    });

    it('does not confuse the same mark on different categories', () => {
        const document = baseDocument();
        document.elements = [
            { ...wall('wall-1'), mark: 'A' },
            { ...door('door-1', 'wall-1'), mark: 'A' },
        ];

        expect(reviewDocument(document)).toHaveLength(0);
    });
});

describe('purgeUnusedTypes', () => {
    it('drops types nothing references and counts them', () => {
        const document = baseDocument();
        document.elements = [wall('wall-1'), door('door-1', 'wall-1')];

        const purged = purgeUnusedTypes(document);

        expect(purged.purged).toBe(2);
        expect(purged.document.wallTypes.map((type) => type.id)).toEqual([
            'generic-200',
        ]);
        expect(purged.document.doorTypes.map((type) => type.id)).toEqual([
            'door-915',
        ]);
    });

    it('never empties a catalogue, even in an empty model', () => {
        const purged = purgeUnusedTypes(baseDocument());

        expect(purged.document.wallTypes.length).toBeGreaterThan(0);
        expect(purged.document.doorTypes.length).toBeGreaterThan(0);
        expect(purged.document.windowTypes.length).toBeGreaterThan(0);
    });

    it('purging twice changes nothing more', () => {
        const document = baseDocument();
        document.elements = [wall('wall-1')];

        const once = purgeUnusedTypes(document);
        const twice = purgeUnusedTypes(once.document);

        expect(twice.purged).toBe(0);
        expect(twice.document.wallTypes).toEqual(once.document.wallTypes);
    });
});
