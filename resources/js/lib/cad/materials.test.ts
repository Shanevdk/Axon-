import { describe, expect, it } from 'vitest';
import { buildModelFaces } from '@/lib/cad/mesh';
import { NATURAL_MATERIALS } from '@/lib/cad/theme';
import type { CadDocument, ViewSettings, WallElement } from '@/lib/cad/types';
import {
    DEFAULT_VIEW_SETTINGS,
    defaultSettingsFor,
    settingsFor,
    withNaturalMaterials,
} from '@/lib/cad/views';

function documentWith(elements: CadDocument['elements']): CadDocument {
    return {
        version: 1,
        units: 'metric',
        levels: [{ id: 'l1', name: 'Level 1', elevation: 0 }],
        wallTypes: [
            {
                id: 'stud',
                name: 'Exterior - Stud',
                thickness: 200,
                function: 'exterior',
                construction: 'wood',
            },
            {
                id: 'conc',
                name: 'Exterior - 300 Concrete',
                thickness: 300,
                function: 'exterior',
                construction: 'concrete',
            },
        ],
        doorTypes: [],
        windowTypes: [],
        elements,
        viewSettings: {},
    };
}

function wall(id: string, typeId: string): WallElement {
    return {
        id,
        kind: 'wall',
        level: 'l1',
        typeId,
        a: { x: 0, y: 0 },
        b: { x: 4000, y: 0 },
        height: 2400,
        baseOffset: 0,
        locationLine: 'center',
    };
}

function settingsWith(style: ViewSettings['visualStyle']): ViewSettings {
    return { ...DEFAULT_VIEW_SETTINGS, visualStyle: style };
}

describe('turning materials on', () => {
    it('shades the view, because hidden line cannot show a colour', () => {
        // The 3D view opens in hidden line, which paints every face white.
        // Switching materials on there has to bring the style with it or the
        // control does nothing at all — which is exactly what it used to do.
        expect(DEFAULT_VIEW_SETTINGS.visualStyle).toBe('hiddenLine');

        expect(withNaturalMaterials(settingsWith('hiddenLine'), true)).toEqual({
            naturalMaterials: true,
            visualStyle: 'shaded',
        });

        expect(withNaturalMaterials(settingsWith('wireframe'), true)).toEqual({
            naturalMaterials: true,
            visualStyle: 'shaded',
        });
    });

    it('leaves a style that already fills exactly as it was', () => {
        expect(withNaturalMaterials(settingsWith('shaded'), true)).toEqual({
            naturalMaterials: true,
        });

        expect(withNaturalMaterials(settingsWith('realistic'), true)).toEqual({
            naturalMaterials: true,
        });
    });

    it('leaves the style alone on the way back off', () => {
        // Having asked for shading once, you probably still want it.
        expect(withNaturalMaterials(settingsWith('shaded'), false)).toEqual({
            naturalMaterials: false,
        });
    });
});

describe('what each surface is made of', () => {
    it('reads a wall off what it is built of', () => {
        const framed = buildModelFaces(documentWith([wall('w1', 'stud')]));
        const poured = buildModelFaces(documentWith([wall('w1', 'conc')]));

        expect(new Set(framed.map((face) => face.material))).toEqual(
            new Set(['wood']),
        );
        expect(new Set(poured.map((face) => face.material))).toEqual(
            new Set(['concrete']),
        );
    });

    it('gives an exploded wall a different material for each layer', () => {
        const document = documentWith([wall('w1', 'stud')]);
        const faces = buildModelFaces(document, { factor: 1, focus: 'w1' });
        const materials = new Set(faces.map((face) => face.material));

        // Cladding, sheathing, studs, batt and board are five different
        // things, and each has to draw as itself.
        expect(materials).toContain('wood');
        expect(materials).toContain('sheathing');
        expect(materials).toContain('insulation');
        expect(materials).toContain('gypsum');
    });

    it('has a colour for every material it can name', () => {
        const document = documentWith([wall('w1', 'stud')]);
        const faces = buildModelFaces(document, { factor: 1, focus: 'w1' });

        faces.forEach((face) => {
            expect(NATURAL_MATERIALS[face.material]).toMatch(/^#[0-9a-f]{6}$/i);
        });
    });
});

describe('what a view looks like before anyone changes it', () => {
    const document = documentWith([wall('w1', 'stud')]);

    it('opens the model shaded and in its own materials', () => {
        // Hidden line paints every face white. On a sheet that is the
        // convention; on the 3D view it is a white building on white ground,
        // which reads as a broken screen.
        const settings = settingsFor(document, {
            id: 'threeD:default',
            name: '{3D}',
            kind: 'threeD',
        });

        expect(settings.visualStyle).toBe('shaded');
        expect(settings.naturalMaterials).toBe(true);
    });

    it('opens the site shaded too, since the ground is a material', () => {
        expect(defaultSettingsFor('site').visualStyle).toBe('shaded');
    });

    it('leaves everything drawn on a sheet in hidden line', () => {
        (['plan', 'ceiling', 'elevation', 'section'] as const).forEach(
            (kind) => {
                expect(defaultSettingsFor(kind).visualStyle).toBe('hiddenLine');
                expect(defaultSettingsFor(kind).naturalMaterials).toBe(false);
            },
        );
    });

    it('still lets a stored choice win', () => {
        const chosen = {
            ...document,
            viewSettings: { 'threeD:default': { visualStyle: 'wireframe' } },
        } as CadDocument;

        expect(
            settingsFor(chosen, {
                id: 'threeD:default',
                name: '{3D}',
                kind: 'threeD',
            }).visualStyle,
        ).toBe('wireframe');
    });
});
