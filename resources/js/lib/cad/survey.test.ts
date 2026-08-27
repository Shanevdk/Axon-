import { describe, expect, it } from 'vitest';
import { surveyBuilding } from '@/lib/cad/survey';
import type {
    CadDocument,
    DoorElement,
    FloorElement,
    StairElement,
    WallElement,
    WindowElement,
} from '@/lib/cad/types';

function baseDocument(): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [
            { id: 'level-1', name: 'Ground Floor', elevation: 0 },
            { id: 'level-2', name: 'Upper Floor', elevation: 3000 },
        ],
        wallTypes: [
            {
                id: 'exterior-200',
                name: 'Exterior - 200mm',
                thickness: 200,
                function: 'exterior',
            },
            {
                id: 'interior-92',
                name: 'Interior - 92mm',
                thickness: 92,
                function: 'interior',
            },
        ],
        doorTypes: [
            {
                id: 'door-915',
                name: 'Single-Flush 915',
                width: 915,
                height: 2134,
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

function wall(
    id: string,
    typeId: string,
    level = 'level-1',
    to = { x: 6000, y: 0 },
): WallElement {
    return {
        id,
        kind: 'wall',
        level,
        typeId,
        a: { x: 0, y: 0 },
        b: to,
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
    };
}

describe('surveyBuilding', () => {
    it('says nothing about a drawing with nothing in it', () => {
        expect(surveyBuilding(baseDocument())).toMatchObject({
            empty: true,
            brief: '',
        });
    });

    it('counts only the levels that are built on', () => {
        const document = baseDocument();
        document.elements = [wall('wall-1', 'exterior-200', 'level-1')];

        const survey = surveyBuilding(document);

        expect(survey.empty).toBe(false);
        expect(survey.brief).toContain('Storeys: 1 (Ground Floor at 0.0 m)');
        expect(survey.brief).not.toContain('Upper Floor');
    });

    it('reports both storeys once the upper level is built on', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', 'exterior-200', 'level-1'),
            wall('wall-2', 'exterior-200', 'level-2'),
        ];

        expect(surveyBuilding(document).brief).toContain(
            'Storeys: 2 (Ground Floor at 0.0 m, Upper Floor at 3.0 m)',
        );
    });

    it('separates doors leading outside from the rest', () => {
        const document = baseDocument();
        const door = (id: string, host: string): DoorElement => ({
            id,
            kind: 'door',
            level: 'level-1',
            typeId: 'door-915',
            host,
            t: 0.5,
            flipFace: false,
            flipHand: false,
        });

        document.elements = [
            wall('outside', 'exterior-200'),
            wall('inside', 'interior-92'),
            door('door-1', 'outside'),
            door('door-2', 'inside'),
            door('door-3', 'inside'),
        ];

        expect(surveyBuilding(document).brief).toContain(
            'Doors: 3 in all, 1 of them in exterior walls',
        );
    });

    it('reads a resized opening at its instance size, not its type', () => {
        const document = baseDocument();

        document.elements = [
            wall('outside', 'exterior-200'),
            {
                id: 'door-1',
                kind: 'door',
                level: 'level-1',
                typeId: 'door-915',
                host: 'outside',
                t: 0.5,
                flipFace: false,
                flipHand: false,
                width: 1800,
            } satisfies DoorElement,
        ];

        expect(surveyBuilding(document).brief).toContain(
            'Door widths: 1800 to 1800 mm',
        );
    });

    it('measures glazing against exterior wall area only', () => {
        const document = baseDocument();
        const glazed: WindowElement = {
            id: 'window-1',
            kind: 'window',
            level: 'level-1',
            typeId: 'window-1200',
            host: 'outside',
            t: 0.5,
            flipFace: false,
            flipHand: false,
        };

        document.elements = [
            // 6 m of exterior wall at 3 m high is 18 m²; one 1.2 × 1.5 window
            // is 1.8 m², which is 10 per cent.
            wall('outside', 'exterior-200'),
            wall('inside', 'interior-92'),
            glazed,
        ];

        const brief = surveyBuilding(document).brief;

        expect(brief).toContain(
            'Windows: 1, 2 m² of glazing (10% of exterior wall area)',
        );
        expect(brief).toContain('Sill heights: 900 to 900 mm');
    });

    it('says plainly when there are no stairs, doors or windows', () => {
        const document = baseDocument();
        document.elements = [wall('wall-1', 'exterior-200')];

        const brief = surveyBuilding(document).brief;

        expect(brief).toContain('Doors: none drawn');
        expect(brief).toContain('Stairs: none drawn');
        expect(brief).toContain('Windows: none drawn');
    });

    it('gives each stair its width and rise', () => {
        const document = baseDocument();
        const stair: StairElement = {
            id: 'stair-1',
            kind: 'stair',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 4000, y: 0 },
            width: 1100,
            rise: 3000,
        };

        document.elements = [wall('wall-1', 'exterior-200'), stair];

        expect(surveyBuilding(document).brief).toContain(
            'Stairs: 1, 1100 mm wide rising 3000 mm over 4.0 m',
        );
    });

    it('adds up the floor area drawn', () => {
        const document = baseDocument();
        const slab: FloorElement = {
            id: 'floor-1',
            kind: 'floor',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 10_000, y: 0 },
                { x: 10_000, y: 8000 },
                { x: 0, y: 8000 },
            ],
            thickness: 200,
            offset: 0,
        };

        document.elements = [slab];

        expect(surveyBuilding(document).brief).toContain(
            'Gross floor area drawn: 80 m²',
        );
    });

    it('leaves demolished work out of the survey', () => {
        const document = baseDocument();
        document.elements = [
            wall('wall-1', 'exterior-200'),
            { ...wall('wall-2', 'exterior-200'), phase: 'demolished' },
        ];

        expect(surveyBuilding(document).brief).toContain(
            'Wall types in use: Exterior - 200mm (exterior, 200 mm)',
        );
    });

    it('names the wall types so fire separations can be reasoned about', () => {
        const document = baseDocument();
        document.elements = [
            wall('outside', 'exterior-200'),
            wall('inside', 'interior-92'),
        ];

        expect(surveyBuilding(document).brief).toContain(
            'Exterior - 200mm (exterior, 200 mm), Interior - 92mm (interior, 92 mm)',
        );
    });
});
