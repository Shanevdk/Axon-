/**
 * What a thing is made of, as geometry rather than as quantities.
 *
 * `takeoff.ts` answers "how much do I buy"; this answers "what is in there,
 * and in what order". They read the same `constructionOf()`, so a wall that
 * bills as studs and sheathing also comes apart into studs and sheathing —
 * the exploded view and the bill of materials can never disagree about what
 * a wall is.
 *
 * Layers are listed outside-first, the way a section is drawn and the way a
 * wall is actually built up. Every thickness is millimetres.
 */

import { lerp } from '@/lib/cad/geometry';
import {
    buildWallGeometry,
    constructionOf,
    wallLayers,
    wallsOnLevel,
    wallTypeOf,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import { prism } from '@/lib/cad/solids';
import type { Solid, SolidCategory } from '@/lib/cad/solids';
import { PLATE, studSpacing } from '@/lib/cad/takeoff';
import type {
    CadDocument,
    CadElement,
    FloorElement,
    Material,
    Point,
    RoofElement,
    Units,
    WallElement,
} from '@/lib/cad/types';

/** One layer of a build-up, named the way it would be ordered. */
export type AssemblyLayer = {
    /** What the layer is, e.g. "Sheathing 11mm OSB". */
    name: string;
    /** How thick it is, in millimetres. */
    thickness: number;
    /** Which material bucket it draws as. */
    category: SolidCategory;
    /** What the surface actually is, for drawing it in its own colour. */
    material: Material;
    /**
     * True for a stud cavity, which is not a sheet of anything. Taken apart
     * it is built as the studs and plates it really is, with batt between.
     */
    framed?: boolean;
};

/** A build-up, outside face first. */
export type Assembly = {
    /** What the whole thing is, e.g. "Exterior - Brick on Stud". */
    name: string;
    layers: AssemblyLayer[];
    /** Sum of the layer thicknesses. */
    thickness: number;
};

/* ------------------------------------------------------------- thicknesses */

const SHEATHING = 11;
const GYPSUM = 12.7;
const SUBFLOOR = 18;
const SHINGLES = 6;
const UNDERLAY = 2;

/**
 * The layers of one element, outside first, or null when it is not something
 * with a build-up — a beam is a beam all the way through.
 */
export function assemblyOf(
    document: CadDocument,
    element: CadElement,
): Assembly | null {
    switch (element.kind) {
        case 'wall':
            return wallAssembly(document, element);
        case 'floor':
            return floorAssembly(document, element);
        case 'roof':
            return roofAssembly(element);
        case 'ceiling':
            return ceilingAssembly();
        default:
            return null;
    }
}

function named(layers: AssemblyLayer[], name: string): Assembly {
    return {
        name,
        layers,
        thickness: layers.reduce((total, layer) => total + layer.thickness, 0),
    };
}

function wallAssembly(document: CadDocument, wall: WallElement): Assembly {
    const type = wallTypeOf(document, wall.typeId);
    const construction = constructionOf(document, wall);
    const exterior = type.function === 'exterior';

    if (construction === 'glazed') {
        return named(
            [
                {
                    name: 'Glazing',
                    thickness: type.thickness,
                    category: 'window',
                    material: 'glass',
                },
            ],
            type.name,
        );
    }

    if (construction === 'concrete') {
        return named(
            [
                {
                    name: 'Cast-in-place concrete',
                    thickness: type.thickness,
                    category: 'wall',
                    material: 'concrete',
                },
            ],
            type.name,
        );
    }

    if (construction === 'masonry') {
        return named(
            [
                {
                    name: 'Concrete block',
                    thickness: type.thickness,
                    category: 'wall',
                    material: 'masonry',
                },
            ],
            type.name,
        );
    }

    // Framed, and so layered.
    //
    // The layers are slices of the wall that is drawn, so they have to add up
    // to its thickness exactly or the exploded parts would not reassemble
    // into the wall they came from. The skins are what they are and the stud
    // cavity takes up whatever is left — which is also how a wall is really
    // detailed, the studs sized to make the build-up land on its dimension.
    const { finish, core } = wallLayers(type);
    const total = type.thickness;
    const skins: AssemblyLayer[] = [];

    if (exterior) {
        if (finish > 0) {
            skins.push({
                name: 'Cladding',
                thickness: finish,
                category: 'wall',
                material: 'wood',
            });
        }

        skins.push({
            name: 'Sheathing 11mm OSB',
            thickness: Math.min(SHEATHING, core / 4),
            category: 'floor',
            material: 'sheathing',
        });
    } else {
        skins.push({
            name: 'Gypsum board 12.7mm',
            thickness: Math.min(GYPSUM, total / 4),
            category: 'ceiling',
            material: 'gypsum',
        });
    }

    const inner: AssemblyLayer = {
        name: 'Gypsum board 12.7mm',
        thickness: Math.min(GYPSUM, total / 4),
        category: 'ceiling',
        material: 'gypsum',
    };

    const skinned =
        skins.reduce((sum, layer) => sum + layer.thickness, 0) +
        inner.thickness;
    const cavity = Math.max(total - skinned, 1);

    return named(
        [
            ...skins,
            {
                name: exterior
                    ? `Studs and insulation ${Math.round(cavity)}mm`
                    : `Studs ${Math.round(cavity)}mm`,
                thickness: cavity,
                category: 'beam',
                material: 'wood',
                framed: true,
            },
            inner,
        ],
        type.name,
    );
}

function floorAssembly(document: CadDocument, floor: FloorElement): Assembly {
    if (constructionOf(document, floor) === 'concrete') {
        return named(
            [
                {
                    name: 'Concrete slab',
                    thickness: floor.thickness,
                    category: 'floor',
                    material: 'concrete',
                },
            ],
            'Slab on grade',
        );
    }

    // As with a wall, the layers have to close on the floor's own thickness.
    const deck = Math.min(SUBFLOOR, floor.thickness / 4);
    const joists = Math.max(floor.thickness - deck, 1);

    return named(
        [
            {
                name: 'Subfloor 18mm T&G',
                thickness: deck,
                category: 'floor',
                material: 'sheathing',
            },
            {
                name: `Joists ${Math.round(joists)}mm`,
                thickness: joists,
                category: 'beam',
                material: 'wood',
            },
        ],
        'Framed floor',
    );
}

function roofAssembly(roof: RoofElement): Assembly {
    return named(
        [
            {
                name: 'Asphalt shingles',
                thickness: SHINGLES,
                category: 'roof',
                material: 'shingle',
            },
            {
                name: 'Roofing underlay',
                thickness: UNDERLAY,
                category: 'roof',
                material: 'shingle',
            },
            {
                name: 'Roof sheathing 11mm OSB',
                thickness: SHEATHING,
                category: 'floor',
                material: 'sheathing',
            },
            {
                name: 'Rafters',
                thickness: 184,
                category: 'beam',
                material: 'wood',
            },
        ],
        `Pitched roof ${roof.slope}°`,
    );
}

function ceilingAssembly(): Assembly {
    return named(
        [
            {
                name: 'Gypsum board 12.7mm',
                thickness: GYPSUM,
                category: 'ceiling',
                material: 'gypsum',
            },
            {
                name: 'Ceiling furring',
                thickness: 38,
                category: 'beam',
                material: 'wood',
            },
        ],
        'Compound ceiling',
    );
}

/* ------------------------------------------------------------- as geometry */

/**
 * The layers of one element as separate solids, in the same order the
 * assembly lists them.
 *
 * A wall's layers are slices across its mitred footprint, so they inherit the
 * corner joins the wall already has; a floor's and a roof's are slices through
 * their thickness. The stud cavity is the exception: it comes back as the
 * actual studs, plates and batt, because a wall taken apart should show its
 * framing rather than a solid slab where the framing ought to be.
 *
 * Anything without a build-up returns an empty list, and the caller should
 * fall back to the element's ordinary solid.
 */
export function assemblySolids(
    document: CadDocument,
    element: CadElement,
): Solid[] {
    const assembly = assemblyOf(document, element);

    if (!assembly || assembly.layers.length === 0) {
        return [];
    }

    const level = document.levels.find((item) => item.id === element.level);
    const elevation = level?.elevation ?? 0;

    if (element.kind === 'wall') {
        const geometry = buildWallGeometry(
            document,
            wallsOnLevel(document, element.level),
        ).get(element.id);

        return geometry
            ? wallLayerSolids(
                  element,
                  geometry,
                  assembly,
                  elevation,
                  document.units,
              )
            : [];
    }

    if (element.kind === 'floor') {
        // A floor hangs below its own top face.
        const top = elevation + element.offset;

        return flatLayerSolids(
            element.id,
            element.level,
            element.points,
            assembly,
            top,
            'down',
        );
    }

    if (element.kind === 'ceiling') {
        const bottom = elevation + element.heightOffset;

        return flatLayerSolids(
            element.id,
            element.level,
            element.points,
            assembly,
            bottom,
            'up',
        );
    }

    if (element.kind === 'roof') {
        // The roof build-up is drawn flat at the plate: this is a parts
        // diagram, not a second attempt at the pitched solid.
        const top = elevation + element.baseOffset + assembly.thickness;

        return flatLayerSolids(
            element.id,
            element.level,
            element.points,
            assembly,
            top,
            'down',
        );
    }

    return [];
}

/**
 * Wall layers, as slices across the thickness of the mitred footprint.
 *
 * The polygon runs [aLeft, bLeft, bRight, aRight], so walking a fraction from
 * the left pair to the right pair walks across the wall — and because both
 * ends are interpolated, every layer keeps the wall's mitred corners.
 */
function wallLayerSolids(
    wall: WallElement,
    geometry: WallGeometry,
    assembly: Assembly,
    elevation: number,
    units: Units,
): Solid[] {
    const [aLeft, bLeft, bRight, aRight] = geometry.polygon;
    const bottom = elevation + wall.baseOffset;
    const top = bottom + wall.height;
    const total = assembly.thickness;
    const solids: Solid[] = [];
    let cursor = 0;

    /**
     * A point on the wall's footprint: `along` runs its length, `across` its
     * thickness, both from nothing to one.
     */
    const at = (along: number, across: number): Point =>
        lerp(lerp(aLeft, bLeft, along), lerp(aRight, bRight, along), across);

    /** The footprint of a box cut out of the wall between two of each. */
    const patch = (
        from: number,
        to: number,
        near: number,
        far: number,
    ): Point[] => [at(from, near), at(to, near), at(to, far), at(from, far)];

    assembly.layers.forEach((layer, index) => {
        const near = cursor / total;
        const far = (cursor + layer.thickness) / total;
        cursor += layer.thickness;

        const push = (
            id: string,
            name: string,
            footprint: Point[],
            from: number,
            to: number,
            material: Material,
            category: SolidCategory,
        ) => {
            const faces = prism(footprint, from, to);

            if (faces.length > 0) {
                solids.push({
                    id: `${wall.id}-layer-${index}-${id}`,
                    name,
                    category,
                    elementId: wall.id,
                    level: wall.level,
                    faces,
                    base: from,
                    material,
                    assemblyLayer: index,
                });
            }
        };

        if (!layer.framed) {
            push(
                'sheet',
                layer.name,
                patch(0, 1, near, far),
                bottom,
                top,
                layer.material,
                layer.category,
            );

            return;
        }

        // A framed cavity: the plates that cap it, the studs standing between
        // them, and the batt filling every bay.
        push(
            'sole-plate',
            'Sole plate',
            patch(0, 1, near, far),
            bottom,
            bottom + PLATE,
            'wood',
            'beam',
        );
        push(
            'top-plate',
            'Double top plate',
            patch(0, 1, near, far),
            top - PLATE * 2,
            top,
            'wood',
            'beam',
        );

        const length = geometry.length;
        const studBottom = bottom + PLATE;
        const studTop = top - PLATE * 2;

        if (length <= PLATE * 2 || studTop <= studBottom) {
            return;
        }

        const centres = studCentres(length, studSpacing(units));

        centres.forEach((centre, stud) => {
            push(
                `stud-${stud}`,
                'Stud',
                patch(
                    (centre - PLATE / 2) / length,
                    (centre + PLATE / 2) / length,
                    near,
                    far,
                ),
                studBottom,
                studTop,
                'wood',
                'beam',
            );

            // The bay between this stud and the next one along.
            const next = centres[stud + 1];

            if (next === undefined) {
                return;
            }

            push(
                `bay-${stud}`,
                'Batt insulation',
                patch(
                    (centre + PLATE / 2) / length,
                    (next - PLATE / 2) / length,
                    near,
                    far,
                ),
                studBottom,
                studTop,
                'insulation',
                'beam',
            );
        });
    });

    return solids;
}

/**
 * Where the studs stand: one hard against each end of the wall and the rest
 * at centres between them, which is how a wall is actually laid out.
 */
export function studCentres(length: number, spacing: number): number[] {
    const first = PLATE / 2;
    const last = length - PLATE / 2;
    const centres = [first];

    for (let at = spacing; at < last - PLATE; at += spacing) {
        centres.push(at);
    }

    if (last > first + PLATE) {
        centres.push(last);
    }

    return centres;
}

/**
 * Layers of a flat build-up, stacked from a face either downward (a floor or
 * a roof, whose top is the face you see) or upward (a ceiling).
 */
function flatLayerSolids(
    elementId: string,
    level: string,
    points: Point[],
    assembly: Assembly,
    face: number,
    direction: 'up' | 'down',
): Solid[] {
    const solids: Solid[] = [];
    let cursor = 0;

    assembly.layers.forEach((layer, index) => {
        const near = direction === 'down' ? face - cursor : face + cursor;
        const far =
            direction === 'down'
                ? near - layer.thickness
                : near + layer.thickness;
        cursor += layer.thickness;

        const faces = prism(points, Math.min(near, far), Math.max(near, far));

        if (faces.length > 0) {
            solids.push({
                id: `${elementId}-layer-${index}`,
                name: layer.name,
                category: layer.category,
                elementId,
                level,
                faces,
                base: Math.min(near, far),
                material: layer.material,
                assemblyLayer: index,
            });
        }
    });

    return solids;
}
