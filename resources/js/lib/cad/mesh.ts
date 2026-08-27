import { buildSolids, triangulateFace } from '@/lib/cad/solids';
import type { SolidCategory, Vec3 } from '@/lib/cad/solids';
import { MODEL_MATERIALS } from '@/lib/cad/theme';
import type { CadDocument } from '@/lib/cad/types';

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
 */
export function buildModelFaces(document: CadDocument): Face[] {
    const faces: Face[] = [];

    buildSolids(document).forEach((solid) => {
        const color =
            solid.category === 'wall'
                ? wallColor(document, solid.elementId)
                : MATERIALS[solid.category];

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

/** A large plate under the model so shaded views have something to sit on. */
export function groundFace(document: CadDocument): Face {
    const extent = 60_000;
    const base = Math.min(
        ...document.levels.map((level) => level.elevation),
        0,
    );

    return {
        vertices: [
            { x: -extent, y: -extent, z: base - 400 },
            { x: extent, y: -extent, z: base - 400 },
            { x: extent, y: extent, z: base - 400 },
            { x: -extent, y: extent, z: base - 400 },
        ],
        color: '#2a2825',
        elementId: NO_ELEMENT,
        layer: 0,
        order: 0,
    };
}
