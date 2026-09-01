import { explodedSolids } from '@/lib/cad/explode';
import type { ExplodeOptions } from '@/lib/cad/explode';
import { constructionOf } from '@/lib/cad/model';
import { buildSolids, triangulateFace } from '@/lib/cad/solids';
import type { Solid, SolidCategory, Vec3 } from '@/lib/cad/solids';
import { heightAt, terrainBounds } from '@/lib/cad/terrain';
import { MODEL_MATERIALS } from '@/lib/cad/theme';
import type { CadDocument, Construction, Material } from '@/lib/cad/types';

export type Vertex = Vec3;

export type Face = {
    vertices: Vertex[];
    color: string;
    elementId: string;
    /** Draw order bucket: ground, then slabs bottom-up, then everything else. */
    layer: number;
    /** Secondary key inside a layer, used to stack slabs by elevation. */
    order: number;
    opacity?: number;
    /**
     * What the surface actually is. The renderer draws either the palette
     * colour above or this material's own colour, depending on the view.
     */
    material: Material;
};

const NO_ELEMENT = '';

const MATERIALS: Record<SolidCategory, string> = {
    wall: MODEL_MATERIALS.wallExterior,
    column: MODEL_MATERIALS.column,
    floor: MODEL_MATERIALS.floor,
    door: MODEL_MATERIALS.doorLeaf,
    window: MODEL_MATERIALS.glass,
    mesh: MODEL_MATERIALS.mesh,
    roof: MODEL_MATERIALS.roofSlab,
    ceiling: MODEL_MATERIALS.wallInterior,
    stair: MODEL_MATERIALS.column,
    beam: MODEL_MATERIALS.frame,
    railing: MODEL_MATERIALS.railing,
    foundation: MODEL_MATERIALS.foundation,
    duct: MODEL_MATERIALS.duct,
    pipe: MODEL_MATERIALS.pipe,
    cableTray: MODEL_MATERIALS.cableTray,
    fixture: MODEL_MATERIALS.fixture,
    planting: MODEL_MATERIALS.planting,
    site: MODEL_MATERIALS.site,
};

/**
 * Flat-shaded faces for the 3D and elevation views.
 *
 * The volumes come from the same solid builder the exporters use, so what is
 * on screen is exactly what lands in an STL or STEP file. Only the caps of
 * slabs are split into triangles here, to stop one large polygon sorting in
 * front of the walls standing on it.
 *
 * An `explode` moves those same solids apart before they are shaded, so the
 * exploded view is the ordinary view with the parts pulled off each other —
 * never a second way of building the model.
 */
export function buildModelFaces(
    document: CadDocument,
    explode?: ExplodeOptions,
): Face[] {
    const faces: Face[] = [];
    const solids =
        explode && explode.factor > 0
            ? explodedSolids(document, explode)
            : buildSolids(document);

    solids.forEach((solid) => {
        const color =
            solid.category === 'wall'
                ? wallColor(document, solid.elementId)
                : MATERIALS[solid.category];

        const material = solid.material ?? materialFor(document, solid);

        solid.faces.forEach((face) => {
            const pieces = face.length > 4 ? triangulateFace(face) : [face];

            pieces.forEach((piece) => {
                faces.push({
                    vertices: piece,
                    color,
                    elementId: solid.elementId,
                    layer:
                        solid.category === 'floor' ||
                        solid.category === 'site' ||
                        solid.category === 'foundation'
                            ? 1
                            : 2,
                    order: solid.base,
                    opacity: solid.category === 'window' ? 0.55 : undefined,
                    material,
                });
            });
        });
    });

    return faces;
}

function wallColor(document: CadDocument, wallId: string): string {
    const wall = document.elements.find((element) => element.id === wallId);

    if (wall?.kind !== 'wall') {
        return MODEL_MATERIALS.wallExterior;
    }

    const type = document.wallTypes.find((item) => item.id === wall.typeId);

    return type?.function === 'interior'
        ? MODEL_MATERIALS.wallInterior
        : MODEL_MATERIALS.wallExterior;
}

/** How far the ground reaches out from the model, in millimetres. */
const GROUND_EXTENT = 60_000;

/**
 * Quads along each side of the ground mesh.
 *
 * Every one of these is a face the painter's algorithm has to sort, so the
 * grid is deliberately coarser than the survey behind it — the ground reads
 * as ground at this density, and the heights it is sampled from stay exact.
 */
const GROUND_STEPS = 32;

const GROUND_COLOUR = '#2a2825';

/**
 * The ground the model stands on.
 *
 * With no survey this is the old flat plate, sitting just below the lowest
 * level so shaded views have something to rest on. Once a site has been
 * measured it becomes the real thing: a surface sampled from the terrain, at
 * the terrain's own heights, so a building cut into a slope is drawn cut into
 * a slope.
 *
 * That is the whole trick behind ground appearing in the elevations. Every
 * model view — 3D, elevation and section alike — is drawn from these faces,
 * so putting the real surface here puts it in all of them at once, and no
 * view needs to know that terrain exists.
 */
export function groundFaces(document: CadDocument): Face[] {
    const base =
        Math.min(...document.levels.map((level) => level.elevation), 0) - 400;

    const terrain = document.site?.terrain ?? null;

    if (!terrain || terrain.columns < 2 || terrain.rows < 2) {
        return [
            plate(
                [
                    { x: -GROUND_EXTENT, y: -GROUND_EXTENT, z: base },
                    { x: GROUND_EXTENT, y: -GROUND_EXTENT, z: base },
                    { x: GROUND_EXTENT, y: GROUND_EXTENT, z: base },
                    { x: -GROUND_EXTENT, y: GROUND_EXTENT, z: base },
                ],
                0,
            ),
        ];
    }

    // Reach past the survey so the model never stands on a floating island.
    // `heightAt` carries the edge outwards, so the ground runs away level
    // rather than dropping off where the measurements stopped.
    const surveyed = terrainBounds(terrain);
    const minX = Math.min(surveyed.minX, -GROUND_EXTENT);
    const minY = Math.min(surveyed.minY, -GROUND_EXTENT);
    const maxX = Math.max(surveyed.maxX, GROUND_EXTENT);
    const maxY = Math.max(surveyed.maxY, GROUND_EXTENT);

    const stepX = (maxX - minX) / GROUND_STEPS;
    const stepY = (maxY - minY) / GROUND_STEPS;

    const at = (column: number, row: number): Vertex => {
        const point = { x: minX + column * stepX, y: minY + row * stepY };

        return { ...point, z: heightAt(terrain, point) };
    };

    const faces: Face[] = [];

    for (let row = 0; row < GROUND_STEPS; row += 1) {
        for (let column = 0; column < GROUND_STEPS; column += 1) {
            // Anticlockwise seen from above, matching every other upward face.
            faces.push(
                plate(
                    [
                        at(column, row),
                        at(column + 1, row),
                        at(column + 1, row + 1),
                        at(column, row + 1),
                    ],
                    row * GROUND_STEPS + column,
                ),
            );
        }
    }

    return faces;
}

function plate(vertices: Vertex[], order: number): Face {
    return {
        vertices,
        color: GROUND_COLOUR,
        elementId: NO_ELEMENT,
        layer: 0,
        order,
        material: 'earth',
    };
}

/**
 * What a solid is actually made of, when it has not said so itself.
 *
 * An assembly layer knows — its sheathing is sheathing — but an ordinary
 * wall solid only knows it is a wall, so the answer comes from what the
 * element is built of. The two questions are different: `Construction` is
 * what an element is framed in, `Material` is what one surface is.
 */
function materialFor(document: CadDocument, solid: Solid): Material {
    switch (solid.category) {
        case 'window':
            return 'glass';
        case 'door':
            return 'wood';
        case 'roof':
            return 'shingle';
        case 'ceiling':
            return 'gypsum';
        case 'foundation':
            return 'concrete';
        case 'duct':
        case 'cableTray':
        case 'pipe':
            return 'metal';
        case 'site':
            return 'earth';
        case 'planting':
            return 'foliage';
        case 'mesh':
        case 'fixture':
            return 'generic';
        default:
            return fromConstruction(document, solid.elementId);
    }
}

/** The material a body reads as, given what its element is built of. */
function fromConstruction(document: CadDocument, elementId: string): Material {
    const element = document.elements.find((item) => item.id === elementId);

    if (!element) {
        return 'generic';
    }

    const construction: Construction = constructionOf(document, element);
    const materials: Record<Construction, Material> = {
        wood: 'wood',
        steel: 'steel',
        concrete: 'concrete',
        masonry: 'masonry',
        glazed: 'glass',
    };

    return materials[construction];
}
