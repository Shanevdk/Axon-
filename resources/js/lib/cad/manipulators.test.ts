import { describe, expect, it } from 'vitest';
import {
    applyGrip,
    flipControlsFor,
    gripsFor,
    temporaryDimensionsFor,
} from '@/lib/cad/manipulators';
import { buildWallGeometry, wallsOnLevel } from '@/lib/cad/model';
import type { CadDocument, DoorElement, WallElement } from '@/lib/cad/types';

function documentWithWall(): CadDocument {
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
        elements: [
            {
                id: 'wall-1',
                kind: 'wall',
                level: 'level-1',
                typeId: 'generic-200',
                a: { x: 0, y: 0 },
                b: { x: 6000, y: 0 },
                height: 3000,
                baseOffset: 0,
                locationLine: 'center',
            } satisfies WallElement,
            {
                id: 'door-1',
                kind: 'door',
                level: 'level-1',
                typeId: 'door-915',
                host: 'wall-1',
                t: 0.5,
                flipFace: false,
                flipHand: false,
            } satisfies DoorElement,
        ],
        viewSettings: {},
    };
}

function geometryOf(document: CadDocument) {
    return buildWallGeometry(document, wallsOnLevel(document, 'level-1'));
}

describe('gripsFor', () => {
    it('puts a grip on each end of a selected wall', () => {
        const document = documentWithWall();
        const grips = gripsFor(document, ['wall-1'], geometryOf(document));

        expect(grips).toHaveLength(2);
        expect(grips[0]).toMatchObject({
            kind: 'wallEnd',
            end: 'a',
            point: { x: 0, y: 0 },
        });
        expect(grips[1]).toMatchObject({
            kind: 'wallEnd',
            end: 'b',
            point: { x: 6000, y: 0 },
        });
    });

    it('puts a slide grip at the centre of a selected door', () => {
        const document = documentWithWall();
        const grips = gripsFor(document, ['door-1'], geometryOf(document));

        expect(grips).toHaveLength(1);
        expect(grips[0].kind).toBe('openingSlide');
        expect(grips[0].point.x).toBeCloseTo(3000);
    });
});

describe('applyGrip', () => {
    it('moves a wall end onto the target point', () => {
        const document = documentWithWall();
        const geometry = geometryOf(document);
        const [gripA] = gripsFor(document, ['wall-1'], geometry);

        const next = applyGrip(document, gripA, { x: -1500, y: 500 }, geometry);
        const wall = next.elements.find(
            (element): element is WallElement => element.kind === 'wall',
        );

        expect(wall?.a).toEqual({ x: -1500, y: 500 });
        expect(wall?.b).toEqual({ x: 6000, y: 0 });
    });

    it('slides a door along its host and clamps at the wall end', () => {
        const document = documentWithWall();
        const geometry = geometryOf(document);
        const [slide] = gripsFor(document, ['door-1'], geometry);

        const next = applyGrip(document, slide, { x: 99_999, y: 0 }, geometry);
        const door = next.elements.find(
            (element): element is DoorElement => element.kind === 'door',
        );

        // Clamped so the 915 leaf stays inside the 6000 wall.
        expect(door?.t).toBeCloseTo(1 - 915 / 2 / 6000);
    });
});

describe('flipControlsFor', () => {
    it('offers face and hand flips for a selected door', () => {
        const document = documentWithWall();
        const controls = flipControlsFor(
            document,
            ['door-1'],
            geometryOf(document),
        );

        expect(controls.map((control) => control.axis)).toEqual([
            'face',
            'hand',
        ]);
        expect(controls[0].anchor.x).toBeCloseTo(3000);
    });

    it('offers nothing for a wall', () => {
        const document = documentWithWall();

        expect(
            flipControlsFor(document, ['wall-1'], geometryOf(document)),
        ).toHaveLength(0);
    });
});

describe('temporaryDimensionsFor', () => {
    it('reports the length of a selected wall and applies an override', () => {
        const document = documentWithWall();
        const [length] = temporaryDimensionsFor(
            document,
            ['wall-1'],
            geometryOf(document),
        );

        expect(length.value).toBeCloseTo(6000);

        const next = length.apply(document, 4500);
        const wall = next.elements.find(
            (element): element is WallElement => element.kind === 'wall',
        );

        expect(wall?.b.x).toBeCloseTo(4500);
        expect(wall?.b.y).toBeCloseTo(0);
    });

    it('reports the distance from each wall end to a selected door', () => {
        const document = documentWithWall();
        const dimensions = temporaryDimensionsFor(
            document,
            ['door-1'],
            geometryOf(document),
        );

        expect(dimensions).toHaveLength(2);
        expect(dimensions[0].value).toBeCloseTo(3000);
        expect(dimensions[1].value).toBeCloseTo(3000);

        // Typing 2000 into the first dimension moves the door towards `a`.
        const next = dimensions[0].apply(document, 2000);
        const door = next.elements.find(
            (element): element is DoorElement => element.kind === 'door',
        );

        expect(door?.t).toBeCloseTo(2000 / 6000);
    });

    it('shows nothing for a multi-element selection', () => {
        const document = documentWithWall();

        expect(
            temporaryDimensionsFor(
                document,
                ['wall-1', 'door-1'],
                geometryOf(document),
            ),
        ).toHaveLength(0);
    });
});
