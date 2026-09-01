import { describe, expect, it } from 'vitest';
import {
    copyElements,
    hitTest,
    maxOpeningWidth,
    MIN_OPENING_WIDTH,
    mirrorElements,
    openingIsResized,
    openingSize,
    openingTypeSize,
    resizeOpening,
    rotateElements,
    toolForKind,
    translateElements,
    withMatchedTypes,
    withPinned,
} from '@/lib/cad/model';
import {
    cameraBasis,
    pickAt,
    resolvePick,
    tourLength,
    tourPose,
    walkOrbit,
} from '@/lib/cad/render-3d';
import { phaseVisible } from '@/lib/cad/render-plan';
import { buildSolids } from '@/lib/cad/solids';
import type { Solid } from '@/lib/cad/solids';
import type {
    BraceElement,
    CadDocument,
    DuctElement,
    FixtureElement,
    FootingElement,
    PadElement,
    PipeElement,
    PropertyLineElement,
    RailingElement,
    RampElement,
    SectionElement,
    SpotElevationElement,
    ToposurfaceElement,
    WalkthroughElement,
    WallElement,
    WindowElement,
} from '@/lib/cad/types';
import { browserGroups, deriveViews } from '@/lib/cad/views';

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

function zRange(solids: Solid[]): { min: number; max: number } {
    const zs = solids.flatMap((solid) => solid.faces.flat()).map((v) => v.z);

    return { min: Math.min(...zs), max: Math.max(...zs) };
}

describe('railings', () => {
    it('builds a top rail with posts along the run', () => {
        const railing: RailingElement = {
            id: 'railing-1',
            kind: 'railing',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 3600, y: 0 },
            height: 1000,
        };
        const document = baseDocument();
        document.elements = [railing];

        const solids = buildSolids(document);

        // A 3.6m run at 1200 spacing: the rail plus four posts.
        expect(solids).toHaveLength(5);
        expect(solids.every((solid) => solid.category === 'railing')).toBe(
            true,
        );
        expect(zRange(solids).max).toBeCloseTo(1000);
    });
});

describe('structure', () => {
    it('spreads a footing below the level', () => {
        const footing: FootingElement = {
            id: 'footing-1',
            kind: 'footing',
            level: 'level-1',
            p: { x: 1000, y: 1000 },
            width: 900,
            depth: 300,
        };
        const document = baseDocument();
        document.elements = [footing];

        const solids = buildSolids(document);

        expect(solids).toHaveLength(1);
        expect(solids[0].category).toBe('foundation');
        expect(zRange(solids)).toEqual({ min: -300, max: 0 });
    });

    it('climbs a brace from the level to its rise', () => {
        const brace: BraceElement = {
            id: 'brace-1',
            kind: 'brace',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 4000, y: 0 },
            width: 150,
            rise: 3000,
        };
        const document = baseDocument();
        document.elements = [brace];

        const solids = buildSolids(document);

        expect(solids).toHaveLength(1);
        expect(zRange(solids)).toEqual({ min: 0, max: 3000 });
    });
});

describe('MEP services', () => {
    it('centres each run on its elevation above the level', () => {
        const duct: DuctElement = {
            id: 'duct-1',
            kind: 'duct',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 5000, y: 0 },
            width: 400,
            elevation: 2700,
            system: 'supply',
        };
        const pipe: PipeElement = {
            id: 'pipe-1',
            kind: 'pipe',
            level: 'level-1',
            a: { x: 0, y: 1000 },
            b: { x: 5000, y: 1000 },
            diameter: 100,
            elevation: 2500,
            system: 'sanitary',
        };
        const document = baseDocument();
        document.elements = [duct, pipe];

        const solids = buildSolids(document);
        const ductSolid = solids.find((solid) => solid.elementId === 'duct-1');
        const pipeSolid = solids.find((solid) => solid.elementId === 'pipe-1');

        // A 400 duct carries a 200 deep section either side of 2700.
        expect(zRange([ductSolid!])).toEqual({ min: 2600, max: 2800 });
        expect(zRange([pipeSolid!])).toEqual({ min: 2450, max: 2550 });
        expect(ductSolid!.category).toBe('duct');
        expect(pipeSolid!.category).toBe('pipe');
    });

    it('picks a duct by its full width in plan', () => {
        const duct: DuctElement = {
            id: 'duct-1',
            kind: 'duct',
            level: 'level-1',
            a: { x: 0, y: 0 },
            b: { x: 5000, y: 0 },
            width: 400,
            elevation: 2700,
            system: 'supply',
        };
        const document = baseDocument();
        document.elements = [duct];

        const hit = hitTest(
            document,
            'level-1',
            { x: 2500, y: 150 },
            10,
            new Map(),
            new Map(),
        );

        expect(hit?.id).toBe('duct-1');
    });
});

describe('components', () => {
    it('grows planting a trunk under its canopy', () => {
        const tree: FixtureElement = {
            id: 'tree-1',
            kind: 'fixture',
            level: 'level-1',
            p: { x: 0, y: 0 },
            rotation: 0,
            category: 'planting',
            name: 'Deciduous Tree',
            width: 3500,
            depth: 3500,
            height: 6000,
            elevation: 0,
        };
        const document = baseDocument();
        document.elements = [tree];

        const solids = buildSolids(document);
        const categories = solids.map((solid) => solid.category).sort();

        expect(categories).toEqual(['fixture', 'planting']);
        expect(zRange(solids).max).toBeCloseTo(6000);
    });

    it('hit-tests a component through its rotation', () => {
        const desk: FixtureElement = {
            id: 'desk-1',
            kind: 'fixture',
            level: 'level-1',
            p: { x: 0, y: 0 },
            rotation: Math.PI / 2,
            category: 'furniture',
            name: 'Desk',
            width: 2000,
            depth: 500,
            height: 750,
            elevation: 0,
        };
        const document = baseDocument();
        document.elements = [desk];

        const pick = (x: number, y: number) =>
            hitTest(document, 'level-1', { x, y }, 5, new Map(), new Map());

        // Rotated a quarter turn, the long side now runs north-south.
        expect(pick(0, 800)?.id).toBe('desk-1');
        expect(pick(800, 0)).toBeNull();
    });

    it('keeps the rotation parameter in step when rotated as a selection', () => {
        const desk: FixtureElement = {
            id: 'desk-1',
            kind: 'fixture',
            level: 'level-1',
            p: { x: 1000, y: 0 },
            rotation: 0,
            category: 'furniture',
            name: 'Desk',
            width: 2000,
            depth: 500,
            height: 750,
            elevation: 0,
        };
        const document = baseDocument();
        document.elements = [desk];

        const turned = rotateElements(
            document,
            ['desk-1'],
            { x: 0, y: 0 },
            Math.PI / 2,
        );
        const element = turned.elements[0] as FixtureElement;

        expect(element.rotation).toBeCloseTo(Math.PI / 2);
        expect(element.p.x).toBeCloseTo(0);
        expect(element.p.y).toBeCloseTo(1000);
    });
});

describe('the site', () => {
    it('models pads and toposurfaces below the level', () => {
        const pad: PadElement = {
            id: 'pad-1',
            kind: 'pad',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 8000, y: 0 },
                { x: 8000, y: 6000 },
                { x: 0, y: 6000 },
            ],
            thickness: 300,
        };
        const topo: ToposurfaceElement = {
            id: 'topo-1',
            kind: 'toposurface',
            level: 'level-1',
            points: [
                { x: -10_000, y: -10_000 },
                { x: 20_000, y: -10_000 },
                { x: 20_000, y: 16_000 },
                { x: -10_000, y: 16_000 },
            ],
            depth: 300,
        };
        const document = baseDocument();
        document.elements = [pad, topo];

        const solids = buildSolids(document);

        expect(solids.map((solid) => solid.category).sort()).toEqual([
            'floor',
            'site',
        ]);
        expect(zRange(solids)).toEqual({ min: -300, max: 0 });
    });

    it('keeps property lines and spot elevations out of the model', () => {
        const boundary: PropertyLineElement = {
            id: 'boundary-1',
            kind: 'propertyLine',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 30_000, y: 0 },
                { x: 30_000, y: 20_000 },
                { x: 0, y: 20_000 },
            ],
        };
        const spot: SpotElevationElement = {
            id: 'spot-1',
            kind: 'spotElevation',
            level: 'level-1',
            p: { x: 5000, y: 5000 },
        };
        const document = baseDocument();
        document.elements = [boundary, spot];

        expect(buildSolids(document)).toHaveLength(0);
    });

    it('picks a property line only along its boundary', () => {
        const boundary: PropertyLineElement = {
            id: 'boundary-1',
            kind: 'propertyLine',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 30_000, y: 0 },
                { x: 30_000, y: 20_000 },
                { x: 0, y: 20_000 },
            ],
        };
        const document = baseDocument();
        document.elements = [boundary];

        const pick = (x: number, y: number) =>
            hitTest(document, 'level-1', { x, y }, 10, new Map(), new Map());

        expect(pick(15_000, 5)?.id).toBe('boundary-1');
        expect(pick(15_000, 10_000)).toBeNull();
    });
});

describe('picking in the model view', () => {
    const square = (x: number, y: number, size: number) => [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
    ];

    it('picks the surface nearest the eye, not the one behind it', () => {
        // draw3d hands back its targets sorted nearest first, so the wall in
        // front is the one picked even though both cover the cursor.
        const targets = [
            { elementId: 'front', polygon: square(0, 0, 100), depth: 1000 },
            { elementId: 'behind', polygon: square(0, 0, 100), depth: 9000 },
        ];

        expect(pickAt(targets, { x: 50, y: 50 })).toBe('front');
        expect(pickAt(targets, { x: 500, y: 500 })).toBeNull();
    });

    it('replaces the selection on a plain click', () => {
        expect(
            resolvePick(['old'], 'wall-1', { adding: false, removing: false }),
        ).toEqual(['wall-1']);
    });

    it('adds with Ctrl and never lists the same thing twice', () => {
        expect(
            resolvePick(['a'], 'b', { adding: true, removing: false }),
        ).toEqual(['a', 'b']);

        expect(
            resolvePick(['a', 'b'], 'b', { adding: true, removing: false }),
        ).toEqual(['a', 'b']);
    });

    it('takes away with Shift', () => {
        expect(
            resolvePick(['a', 'b'], 'a', { adding: false, removing: true }),
        ).toEqual(['b']);
    });

    it('clears on a plain click past the building, and only then', () => {
        const held = ['a', 'b'];

        expect(
            resolvePick(held, null, { adding: false, removing: false }),
        ).toEqual([]);

        // A modifier held means the miss was a fumble, not an instruction to
        // throw away what is already picked.
        expect(resolvePick(held, null, { adding: true, removing: false })).toBe(
            held,
        );
        expect(resolvePick(held, null, { adding: false, removing: true })).toBe(
            held,
        );
    });
});

describe('first person', () => {
    it('puts the eye exactly where the walk camera says, looking along yaw', () => {
        const basis = cameraBasis(
            walkOrbit({
                eye: { x: 1000, y: 2000, z: 1600 },
                yaw: Math.PI / 2,
                pitch: 0,
            }),
        );

        expect(basis.eye).toEqual({ x: 1000, y: 2000, z: 1600 });
        // Yaw of a quarter turn looks due north.
        expect(basis.forward.x).toBeCloseTo(0);
        expect(basis.forward.y).toBeCloseTo(1);
        expect(basis.forward.z).toBeCloseTo(0);
    });

    it('walks a tour along its path and turns with it', () => {
        const points = [
            { x: 0, y: 0 },
            { x: 10_000, y: 0 },
            { x: 10_000, y: 10_000 },
        ];

        expect(tourLength(points)).toBeCloseTo(20_000);

        const early = tourPose(points, 5000)!;

        expect(early.position).toEqual({ x: 5000, y: 0 });
        expect(early.yaw).toBeCloseTo(0);

        // Past the corner the camera walks north up the second leg.
        const late = tourPose(points, 15_000)!;

        expect(late.position.x).toBeCloseTo(10_000);
        expect(late.position.y).toBeCloseTo(5000);
        expect(late.yaw).toBeCloseTo(Math.PI / 2);

        // At the end it holds the final direction rather than spinning.
        const end = tourPose(points, 25_000)!;

        expect(end.position).toEqual({ x: 10_000, y: 10_000 });
        expect(end.yaw).toBeCloseTo(Math.PI / 2);
    });

    it('picks a walkthrough path without closing it into a loop', () => {
        const path: WalkthroughElement = {
            id: 'tour-1',
            kind: 'walkthrough',
            level: 'level-1',
            points: [
                { x: 0, y: 0 },
                { x: 10_000, y: 0 },
                { x: 10_000, y: 10_000 },
            ],
            eyeHeight: 1600,
        };
        const document = baseDocument();
        document.elements = [path];

        const pick = (x: number, y: number) =>
            hitTest(document, 'level-1', { x, y }, 10, new Map(), new Map());

        expect(pick(5000, 0)?.id).toBe('tour-1');
        // The would-be closing edge from the last stop back to the first.
        expect(pick(5000, 5000)).toBeNull();

        // And it never reaches the 3D model.
        expect(buildSolids(document)).toHaveLength(0);
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

    it('always offers a site plan, ground or no ground', () => {
        // The site view is where ground levels are measured in the first
        // place, so it cannot be conditional on already having them.
        const views = deriveViews(baseDocument()).filter(
            (view) => view.kind === 'site',
        );

        expect(views).toHaveLength(1);
        expect(views[0].name).toBe('Site');
    });

    it('gives the site plan its own place in the project browser', () => {
        const groups = browserGroups(deriveViews(baseDocument()));

        expect(groups.map((group) => group.title)).toContain('Site');
    });
});

describe('resizing an opening after it is placed', () => {
    function documentWithWindow(
        overrides: Partial<WindowElement> = {},
    ): CadDocument {
        const document = baseDocument();

        document.windowTypes = [
            {
                id: 'window-1200',
                name: 'Fixed 1200 x 1500',
                width: 1200,
                height: 1500,
                sillHeight: 900,
            },
        ];
        document.elements = [
            wallOf('generic-200'),
            {
                id: 'window-1',
                kind: 'window',
                level: 'level-1',
                typeId: 'window-1200',
                host: 'wall-generic-200-new',
                t: 0.5,
                flipFace: false,
                flipHand: false,
                ...overrides,
            } satisfies WindowElement,
        ];

        return document;
    }

    function windowOf(document: CadDocument): WindowElement {
        return document.elements.find(
            (element): element is WindowElement => element.kind === 'window',
        )!;
    }

    it('follows its type until it is given a size of its own', () => {
        const document = documentWithWindow();
        const opening = windowOf(document);

        expect(openingIsResized(opening)).toBe(false);
        expect(openingSize(document, opening)).toEqual({
            width: 1200,
            height: 1500,
            sillHeight: 900,
        });
    });

    it('prefers the instance size over the type, one field at a time', () => {
        const document = documentWithWindow({ width: 2400 });
        const opening = windowOf(document);

        expect(openingIsResized(opening)).toBe(true);
        expect(openingSize(document, opening)).toEqual({
            // Only width was overridden; the rest still come from the type.
            width: 2400,
            height: 1500,
            sillHeight: 900,
        });
        expect(openingTypeSize(document, opening).width).toBe(1200);
    });

    it('resizing one window leaves its neighbours of the same type alone', () => {
        const document = documentWithWindow();
        const twin: WindowElement = {
            ...windowOf(document),
            id: 'window-2',
            t: 0.25,
        };
        document.elements = [...document.elements, twin];

        const resized = resizeOpening(windowOf(document), 1200, 6000, 2400);

        expect(openingSize(document, resized).width).toBe(2400);
        expect(openingSize(document, twin).width).toBe(1200);
        expect(document.windowTypes[0].width).toBe(1200);
    });

    it('keeps a widened opening inside its host wall', () => {
        const document = documentWithWindow();
        const resized = resizeOpening(windowOf(document), 1200, 6000, 99_999);

        expect(resized.width).toBe(maxOpeningWidth(6000));
        expect(openingSize(document, resized).width).toBeLessThan(6000);
    });

    it('refuses to shrink an opening past nothing', () => {
        const document = documentWithWindow();
        const resized = resizeOpening(windowOf(document), 1200, 6000, 10);

        expect(resized.width).toBe(MIN_OPENING_WIDTH);
    });

    it('holds one jamb still when told which side anchors', () => {
        const document = documentWithWindow();
        // Spans 2400 → 3600 on a 6000 wall. Widen to 2000 holding jamb b.
        const resized = resizeOpening(
            windowOf(document),
            1200,
            6000,
            2000,
            'b',
        );

        expect(resized.t * 6000 + 2000 / 2).toBeCloseTo(3600);
    });

    it('carries the instance size into the built solid', () => {
        const short = buildSolids(documentWithWindow());
        const tall = buildSolids(
            documentWithWindow({ height: 2400, sillHeight: 300 }),
        );

        // The glazing sits inside a frame, so compare the two rather than
        // asserting an absolute pane size.
        const extentOf = (solids: Solid[]) => {
            const glazing = solids.filter(
                (solid) => solid.category === 'window',
            );

            expect(glazing.length).toBeGreaterThan(0);

            const zs = glazing.flatMap((solid) =>
                solid.faces.flatMap((face) => face.map((point) => point.z)),
            );

            return { bottom: Math.min(...zs), top: Math.max(...zs) };
        };

        const before = extentOf(short);
        const after = extentOf(tall);

        // 1500 → 2400 tall.
        expect(after.top - after.bottom - (before.top - before.bottom)).toBe(
            900,
        );
        // Sill 900 → 300 drops the whole opening by 600.
        expect(before.bottom - after.bottom).toBe(600);
    });
});

describe('pinning', () => {
    function pinnedWallDocument(): CadDocument {
        const document = baseDocument();
        document.elements = [
            { ...wallOf('generic-200'), id: 'held', pinned: true },
            {
                ...wallOf('generic-200'),
                id: 'loose',
                a: { x: 0, y: 3000 },
                b: { x: 6000, y: 3000 },
            },
        ];

        return document;
    }

    it('a pinned element refuses to move while its neighbours go', () => {
        const moved = translateElements(
            pinnedWallDocument(),
            ['held', 'loose'],
            { x: 500, y: 0 },
        );

        const held = moved.elements[0] as WallElement;
        const loose = moved.elements[1] as WallElement;

        expect(held.a).toEqual({ x: 0, y: 0 });
        expect(loose.a).toEqual({ x: 500, y: 3000 });
    });

    it('a pinned element refuses to rotate and mirror too', () => {
        const spun = rotateElements(
            pinnedWallDocument(),
            ['held'],
            { x: 0, y: 0 },
            Math.PI / 2,
        );

        expect((spun.elements[0] as WallElement).b).toEqual({
            x: 6000,
            y: 0,
        });

        const flipped = mirrorElements(
            pinnedWallDocument(),
            ['held'],
            { x: 0, y: 1000 },
            { x: 6000, y: 1000 },
        );

        expect((flipped.elements[0] as WallElement).a).toEqual({ x: 0, y: 0 });
    });

    it('the copy of a pinned element is not itself pinned', () => {
        const copied = copyElements(pinnedWallDocument(), ['held'], {
            x: 0,
            y: 9000,
        });

        const copy = copied.document.elements.find((element) =>
            copied.ids.includes(element.id),
        );

        expect(copy?.pinned).toBeUndefined();
        expect((copy as WallElement).a).toEqual({ x: 0, y: 9000 });
    });

    it('withPinned sets and releases the pin', () => {
        const document = pinnedWallDocument();
        const released = withPinned(document, ['held'], false);

        expect(released.elements[0].pinned).toBeUndefined();

        const pinned = withPinned(released, ['loose'], true);

        expect(pinned.elements[1].pinned).toBe(true);
    });
});

describe('match type and create similar', () => {
    it('gives every later selected wall the first one’s type', () => {
        const document = baseDocument();
        document.elements = [
            { ...wallOf('curtain-storefront'), id: 'source' },
            { ...wallOf('generic-200'), id: 'target-1' },
            { ...wallOf('generic-200'), id: 'target-2' },
        ];

        const matched = withMatchedTypes(document, [
            'source',
            'target-1',
            'target-2',
        ]);

        expect(matched.changed).toBe(2);
        expect(
            matched.document.elements.map(
                (element) => (element as WallElement).typeId,
            ),
        ).toEqual([
            'curtain-storefront',
            'curtain-storefront',
            'curtain-storefront',
        ]);
    });

    it('matching an opening clears its instance size', () => {
        const document = baseDocument();
        document.doorTypes = [
            { id: 'door-a', name: 'A', width: 915, height: 2134, leaves: 1 },
            { id: 'door-b', name: 'B', width: 800, height: 2100, leaves: 1 },
        ];
        document.elements = [
            wallOf('generic-200'),
            {
                id: 'source',
                kind: 'door',
                level: 'level-1',
                typeId: 'door-a',
                host: 'wall-generic-200-new',
                t: 0.3,
                flipFace: false,
                flipHand: false,
            },
            {
                id: 'target',
                kind: 'door',
                level: 'level-1',
                typeId: 'door-b',
                host: 'wall-generic-200-new',
                t: 0.7,
                flipFace: false,
                flipHand: false,
                width: 1800,
            },
        ];

        const matched = withMatchedTypes(document, ['source', 'target']);
        const target = matched.document.elements[2];

        expect(target.kind === 'door' && target.typeId).toBe('door-a');
        expect(target.kind === 'door' && target.width).toBeUndefined();
    });

    it('leaves elements of another kind alone', () => {
        const document = baseDocument();
        document.elements = [
            { ...wallOf('curtain-storefront'), id: 'source' },
            {
                id: 'bystander',
                kind: 'room',
                level: 'level-1',
                p: { x: 0, y: 0 },
                name: 'Room',
                number: '1',
            },
        ];

        expect(
            withMatchedTypes(document, ['source', 'bystander']).changed,
        ).toBe(0);
    });

    it('toolForKind arms the placing tool, and refuses what nothing places', () => {
        expect(toolForKind('wall')).toBe('wall');
        expect(toolForKind('fixture')).toBe('fixture');
        expect(toolForKind('mesh')).toBeNull();
        expect(toolForKind('door')).toBe('door');
    });
});
