import { describe, expect, it } from 'vitest';
import { reviewDocument } from '@/lib/cad/checkup';
import {
    bringWallsUpToCode,
    checkWallTypes,
    effectiveRsi,
    formatResistance,
    requirementFor,
    thicknessForRequirement,
} from '@/lib/cad/code';
import type { CadDocument, WallElement, WallType } from '@/lib/cad/types';

function documentWith(
    wallTypes: WallType[],
    walls: WallElement[] = [],
): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [{ id: 'l1', name: 'Level 1', elevation: 0 }],
        wallTypes,
        doorTypes: [],
        windowTypes: [],
        elements: walls,
        viewSettings: {},
    };
}

function wall(typeId: string, id = 'w1'): WallElement {
    return {
        id,
        kind: 'wall',
        level: 'l1',
        typeId,
        a: { x: 0, y: 0 },
        b: { x: 5000, y: 0 },
        height: 2400,
        baseOffset: 0,
        locationLine: 'center',
    };
}

const STUD_2X6: WallType = {
    id: 'stud-200',
    name: 'Exterior - Stud',
    thickness: 200,
    function: 'exterior',
    construction: 'wood',
};

const CONCRETE: WallType = {
    id: 'conc',
    name: 'Exterior - 300 Concrete',
    thickness: 300,
    function: 'exterior',
    construction: 'concrete',
};

describe('finding the code that applies', () => {
    it('places a city in its province and names the authority', () => {
        const vancouver = requirementFor('Vancouver, British Columbia, Canada');

        expect(vancouver).toMatchObject({
            region: 'British Columbia (coastal)',
            zone: '4',
        });
        expect(vancouver?.authority).toContain('NBC');

        // Colder province, higher requirement.
        const winnipeg = requirementFor('Winnipeg, Manitoba, Canada');

        expect(winnipeg!.minimumRsi).toBeGreaterThan(vancouver!.minimumRsi);
    });

    it('falls back to the national baseline for an unplaced Canadian address', () => {
        expect(requirementFor('Somewhere, Canada')?.region).toBe('Canada');
    });

    it('says nothing rather than guessing for the rest of the world', () => {
        // The table is Canadian. Pretending otherwise would be worse than
        // staying quiet, so these produce no requirement at all.
        expect(requirementFor('Lyon, France')).toBeNull();
        expect(requirementFor('Seattle, Washington, United States')).toBeNull();
        expect(requirementFor(null)).toBeNull();
        expect(requirementFor('')).toBeNull();
    });
});

describe('what a wall achieves', () => {
    it('rates a framed wall on its cavity, derated for the studs', () => {
        const document = documentWith([STUD_2X6]);
        const rsi = effectiveRsi(document, STUD_2X6);

        // A 200mm stud wall lands around RSI 3, which is R-17 in old money.
        expect(rsi).toBeGreaterThan(2.5);
        expect(rsi).toBeLessThan(3.5);
        expect(formatResistance(rsi, 'imperial')).toMatch(/^R-1[5-9]\./);
    });

    it('rates bare concrete as the thermal bridge it is', () => {
        const document = documentWith([CONCRETE]);

        // Thicker than the stud wall and barely a tenth of the resistance.
        expect(effectiveRsi(document, CONCRETE)).toBeLessThan(1);
    });

    it('passes a stud wall on the coast and fails it on the prairies', () => {
        const document = documentWith([STUD_2X6]);
        const coast = requirementFor('Vancouver, British Columbia, Canada')!;
        const prairie = requirementFor('Regina, Saskatchewan, Canada')!;

        expect(checkWallTypes(document, coast)[0].passes).toBe(true);
        expect(checkWallTypes(document, prairie)[0].passes).toBe(false);
    });

    it('leaves interior partitions out of it', () => {
        const document = documentWith([
            STUD_2X6,
            {
                id: 'part',
                name: 'Interior - 92mm Partition',
                thickness: 92,
                function: 'interior',
                construction: 'wood',
            },
        ]);

        // A partition separates two heated rooms; it has nothing to meet.
        const checked = checkWallTypes(
            document,
            requirementFor('Regina, Saskatchewan, Canada')!,
        );

        expect(checked).toHaveLength(1);
        expect(checked[0].type.id).toBe('stud-200');
    });
});

describe('bringing walls up to code', () => {
    it('thickens only the types that fall short', () => {
        const document = documentWith([STUD_2X6, CONCRETE]);
        const prairie = requirementFor('Regina, Saskatchewan, Canada')!;

        const {
            document: fixed,
            upgraded,
            needsInsulation,
        } = bringWallsUpToCode(document, prairie);

        // The stud wall is deepened; the concrete one is reported instead,
        // because no amount of thickness insulates concrete.
        expect(upgraded).toEqual([STUD_2X6.name]);
        expect(needsInsulation).toEqual([CONCRETE.name]);

        expect(fixed.wallTypes[0].thickness).toBeGreaterThan(
            STUD_2X6.thickness,
        );
        expect(checkWallTypes(fixed, prairie)[0].passes).toBe(true);
        expect(fixed.wallTypes[1].thickness).toBe(CONCRETE.thickness);
    });

    it('never thins a wall somebody drew thicker on purpose', () => {
        const chunky: WallType = { ...STUD_2X6, thickness: 600 };
        const document = documentWith([chunky]);
        const coast = requirementFor('Vancouver, British Columbia, Canada')!;

        const { document: fixed, upgraded } = bringWallsUpToCode(
            document,
            coast,
        );

        // It already passes, so nothing is touched at all.
        expect(upgraded).toEqual([]);
        expect(fixed.wallTypes[0].thickness).toBe(600);
        expect(fixed).toBe(document);
    });

    it('is settled after one pass', () => {
        const document = documentWith([STUD_2X6]);
        const prairie = requirementFor('Regina, Saskatchewan, Canada')!;

        const once = bringWallsUpToCode(document, prairie).document;
        const twice = bringWallsUpToCode(once, prairie);

        expect(twice.upgraded).toEqual([]);
        expect(twice.document).toBe(once);
    });

    it('suggests a thickness that actually meets the number', () => {
        const prairie = requirementFor('Regina, Saskatchewan, Canada')!;
        const thickness = thicknessForRequirement(prairie);
        const document = documentWith([{ ...STUD_2X6, thickness }]);

        expect(checkWallTypes(document, prairie)[0].passes).toBe(true);
    });
});

describe('the warning it raises', () => {
    it('names the shortfall, the authority and the fix', () => {
        const document = documentWith([STUD_2X6], [wall('stud-200')]);

        const warnings = reviewDocument(
            document,
            'Regina, Saskatchewan, Canada',
        );
        const code = warnings.find((item) => item.id.startsWith('code-'));

        expect(code).toBeDefined();
        expect(code!.severity).toBe('warning');
        expect(code!.message).toContain('Saskatchewan');
        expect(code!.message).toContain('NBC');
        expect(code!.elementIds).toEqual(['w1']);
    });

    it('stays quiet about a type nothing is drawn in', () => {
        // The catalogue carries types nobody has used; warning about those
        // would be noise about a wall that does not exist.
        const document = documentWith([STUD_2X6]);

        expect(
            reviewDocument(document, 'Regina, Saskatchewan, Canada').filter(
                (item) => item.id.startsWith('code-'),
            ),
        ).toEqual([]);
    });

    it('stays quiet when nobody has said where the building is', () => {
        const document = documentWith([STUD_2X6], [wall('stud-200')]);

        expect(
            reviewDocument(document).filter((item) =>
                item.id.startsWith('code-'),
            ),
        ).toEqual([]);
    });
});
