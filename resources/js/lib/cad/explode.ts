/**
 * The exploded view.
 *
 * Two things are being shown, and they are different. With nothing selected
 * the whole building comes apart: every element drifts away from the centre
 * and the storeys lift off each other, so you can see how the box is put
 * together. Select one element and it alone comes apart, into the layers
 * `assembly.ts` says it is made of — cladding, sheathing, studs, board — laid
 * out along its own thickness with the rest of the model left standing.
 *
 * Everything here is a pure transform of solids. The renderer is untouched:
 * it draws whatever solids it is handed, so an exploded model is drawn by the
 * same painter's algorithm as an assembled one.
 */

import { assemblyOf, assemblySolids } from '@/lib/cad/assembly';
import type { Assembly } from '@/lib/cad/assembly';
import { boundsOfSolids, buildSolids } from '@/lib/cad/solids';
import type { Solid, Vec3 } from '@/lib/cad/solids';
import type { CadDocument } from '@/lib/cad/types';

export type ExplodeOptions = {
    /**
     * How far apart, from 0 (assembled) to 1 (fully apart). Anything at or
     * below zero leaves the model exactly as it was.
     */
    factor: number;
    /**
     * The element to take apart on its own. Null explodes the whole model.
     */
    focus?: string | null;
};

/**
 * How far the whole model spreads at full explode, as a fraction of its own
 * size. A building drifts apart by about a third of its width, which is
 * enough to read and little enough to still recognise.
 */
const MODEL_SPREAD = 0.35;

/**
 * How far apart the layers of one assembly sit at full explode. A wall is a
 * few hundred millimetres thick, so its layers need a fixed gap rather than a
 * proportional one or they would still be touching.
 */
const LAYER_GAP = 900;

/** How far storeys lift off each other, as a fraction of the model height. */
const STOREY_LIFT = 0.45;

/**
 * The solids to draw for a document, exploded or not.
 *
 * With a focus this returns the focused element replaced by its layers, so
 * the parts you are inspecting are the only thing that moved.
 */
export function explodedSolids(
    document: CadDocument,
    options: ExplodeOptions,
): Solid[] {
    const factor = Math.max(options.factor, 0);
    const solids = buildSolids(document);

    if (factor <= 0) {
        return solids;
    }

    const focus = options.focus ?? null;

    if (focus === null) {
        return spreadWholeModel(document, solids, factor);
    }

    return spreadOneAssembly(document, solids, focus, factor);
}

/**
 * Every element drifts out from the centre of the model, and each storey
 * lifts clear of the one below.
 */
function spreadWholeModel(
    document: CadDocument,
    solids: Solid[],
    factor: number,
): Solid[] {
    const bounds = boundsOfSolids(solids);

    if (!bounds) {
        return solids;
    }

    const centre = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
    };
    const width = Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        1,
    );
    const height = Math.max(bounds.max.z - bounds.min.z, 1);
    const spread = width * MODEL_SPREAD * factor;
    const lift = height * STOREY_LIFT * factor;

    // Elements move as wholes, so a wall and the door in it travel together.
    const centres = elementCentres(solids);

    return solids.map((solid) => {
        const own = centres.get(solid.elementId);
        const storey = document.levels.findIndex(
            (level) => level.id === solid.level,
        );

        if (!own) {
            return solid;
        }

        const away = { x: own.x - centre.x, y: own.y - centre.y };
        const reach = Math.hypot(away.x, away.y);
        // An element sitting dead centre has no direction to go, so it stays
        // put and the rest opens up around it.
        const unit =
            reach < 1
                ? { x: 0, y: 0 }
                : { x: away.x / reach, y: away.y / reach };

        return moveSolid(solid, {
            x: unit.x * spread,
            y: unit.y * spread,
            z: Math.max(storey, 0) * lift,
        });
    });
}

/**
 * One element comes apart into its layers; everything else stands still.
 */
function spreadOneAssembly(
    document: CadDocument,
    solids: Solid[],
    focus: string,
    factor: number,
): Solid[] {
    const element = document.elements.find((item) => item.id === focus);

    if (!element) {
        return solids;
    }

    const layers = assemblySolids(document, element);

    if (layers.length === 0) {
        return solids;
    }

    // The focused element is replaced by its parts, and anything it hosts —
    // a door in the wall — is taken out of the way so the layers read.
    const hosted = new Set(
        document.elements
            .filter(
                (item) =>
                    (item.kind === 'door' || item.kind === 'window') &&
                    item.host === focus,
            )
            .map((item) => item.id),
    );

    const rest = solids.filter(
        (solid) => solid.elementId !== focus && !hosted.has(solid.elementId),
    );

    const direction = layerDirection(document, focus);
    // Layers move, not solids: a framed cavity comes back as a plate, a
    // batt and twenty studs, and all of them belong to the same slice of the
    // sandwich and travel together.
    const count = layers.reduce(
        (highest, layer) => Math.max(highest, (layer.assemblyLayer ?? 0) + 1),
        1,
    );
    const middle = (count - 1) / 2;

    const spread = layers.map((layer) => {
        const step = ((layer.assemblyLayer ?? 0) - middle) * LAYER_GAP * factor;

        return moveSolid(layer, {
            x: direction.x * step,
            y: direction.y * step,
            z: direction.z * step,
        });
    });

    return [...rest, ...spread];
}

/**
 * The way an assembly opens out: a wall along its own normal, so its layers
 * peel off its face; anything flat straight up.
 */
function layerDirection(document: CadDocument, elementId: string): Vec3 {
    const element = document.elements.find((item) => item.id === elementId);

    if (element?.kind === 'wall') {
        const along = {
            x: element.b.x - element.a.x,
            y: element.b.y - element.a.y,
        };
        const length = Math.hypot(along.x, along.y);

        if (length > 0) {
            // Perpendicular to the wall, in plan.
            return { x: -along.y / length, y: along.x / length, z: 0 };
        }
    }

    return { x: 0, y: 0, z: 1 };
}

/** Plan centre of every element, from the solids it produced. */
function elementCentres(
    solids: Solid[],
): Map<string, { x: number; y: number }> {
    const sums = new Map<string, { x: number; y: number; n: number }>();

    solids.forEach((solid) => {
        solid.faces.forEach((face) => {
            face.forEach((vertex) => {
                const held = sums.get(solid.elementId) ?? { x: 0, y: 0, n: 0 };

                held.x += vertex.x;
                held.y += vertex.y;
                held.n += 1;
                sums.set(solid.elementId, held);
            });
        });
    });

    const centres = new Map<string, { x: number; y: number }>();

    sums.forEach((held, id) => {
        if (held.n > 0) {
            centres.set(id, { x: held.x / held.n, y: held.y / held.n });
        }
    });

    return centres;
}

function moveSolid(solid: Solid, by: Vec3): Solid {
    return {
        ...solid,
        faces: solid.faces.map((face) =>
            face.map((vertex) => ({
                x: vertex.x + by.x,
                y: vertex.y + by.y,
                z: vertex.z + by.z,
            })),
        ),
        base: solid.base + by.z,
    };
}

/**
 * The parts list shown beside an exploded element, so the layers on screen
 * can be read off by name and thickness.
 */
export function focusedAssembly(
    document: CadDocument,
    focus: string | null,
): Assembly | null {
    if (focus === null) {
        return null;
    }

    const element = document.elements.find((item) => item.id === focus);

    return element ? assemblyOf(document, element) : null;
}
