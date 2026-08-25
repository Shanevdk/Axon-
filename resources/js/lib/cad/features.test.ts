import { describe, expect, it } from 'vitest';
import { phaseVisible } from '@/lib/cad/render-plan';
import { buildSolids } from '@/lib/cad/solids';
import type {
    CadDocument,
    RampElement,
    SectionElement,
    WallElement,
} from '@/lib/cad/types';
import { deriveViews } from '@/lib/cad/views';

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
                id: 'curtain-storefront',
                name: 'Curtain Wall - Storefront',
                thickness: 150,
                function: 'curtain',
            },
        ],
        doorTypes: [],
        windowTypes: [],
        elements: [],
        viewSettings: {},
    };
}

function wallOf(typeId: string, phase?: WallElement['phase']): WallElement {
    return {
        id: `wall-${typeId}-${phase ?? 'new'}`,
        kind: 'wall',
        level: 'level-1',
        typeId,
        a: { x: 0, y: 0 },
        b: { x: 6000, y: 0 },
        height: 3000,
        baseOffset: 0,
        locationLine: 'center',
        ...(phase ? { phase } : {}),
    };
}

describe('phasing', () => {
    it('filters by phase the way Revit phase filters do', () => {
        const existing = { phase: 'existing' as const };
        const demolished = { phase: 'demolished' as const };
        const fresh = {};

        expect(phaseVisible(fresh, 'all')).toBe(true);
        expect(phaseVisible(existing, 'all')).toBe(true);
        expect(phaseVisible(demolished, 'all')).toBe(true);

        expect(phaseVisible(fresh, 'new')).toBe(true);
        expect(phaseVisible(existing, 'new')).toBe(false);
        expect(phaseVisible(demolished, 'new')).toBe(false);

        expect(phaseVisible(fresh, 'existing')).toBe(false);
        expect(phaseVisible(existing, 'existing')).toBe(true);
    });

    it('keeps demolished elements out of the 3D model', () => {
        const document = baseDocument();
        document.elements = [
            wallOf('generic-200'),
            { ...wallOf('generic-200', 'demolished'), id: 'demo-wall' },
        ];

        const solids = buildSolids(document);

        expect(solids.some((solid) => solid.elementId === 'demo-wall')).toBe(
            false,
        );
        expect(solids.length).toBeGreaterThan(0);
    });
});

describe('curtain walls', () => {
    it('builds glazing and mullions instead of poched runs', () => {
        const document = baseDocument();
        document.elements = [wallOf('curtain-storefront')];

        const solids = buildSolids(document);
        const categories = new Set(solids.map((solid) => solid.category));

        expect(categories.has('window')).toBe(true);
        expect(categories.has('beam')).toBe(true);
        expect(categories.has('wall')).toBe(false);

        // A 6m wall at 1200 module: 6 verticals + head + sill + glazing.
        expect(solids).toHaveLength(9);
    });
});

describe('ramps', () => {
    it('builds a climbing run of slices reaching the rise', () => {
        const ramp: RampElement = {
            id: 'ramp-1',
            kind: 'ramp',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 6000, y: 0 },
            width: 1200,
            rise: 500,
        };
        const document = baseDocument();
        document.elements = [ramp];

        const solids = buildSolids(document);

        expect(solids.length).toBeGreaterThanOrEqual(4);

        const top = Math.max(
            ...solids.flatMap((solid) => solid.faces.flat()).map((v) => v.z),
        );

        expect(top).toBeCloseTo(500);
    });
});

describe('section views', () => {
    it('derives a browser view from each section mark', () => {
        const section: SectionElement = {
            id: 'section-1',
            kind: 'section',
            level: 'level-1',
            a: { x: 0, y: 2000 },
            b: { x: 9000, y: 2000 },
            name: 'Section A',
        };
        const document = baseDocument();
        document.elements = [section];

        const views = deriveViews(document);
        const sectionViews = views.filter((view) => view.kind === 'section');

        expect(sectionViews).toHaveLength(1);
        expect(sectionViews[0].name).toBe('Section A');
        expect(sectionViews[0].sectionId).toBe('section-1');
    });
});
