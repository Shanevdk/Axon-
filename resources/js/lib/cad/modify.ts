/**
 * The Modify-tab operations: trim/extend, split, align, offset and array.
 *
 * Each helper is a pure transform over the document so the canvas flows and
 * the tests exercise identical code. Every length is in millimetres.
 */

import {
    add,
    distance,
    intersectLines,
    normalize,
    perpendicular,
    projectOnSegment,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import { copyElements, createId, findWall } from '@/lib/cad/model';
import type { CadDocument, Point, WallElement } from '@/lib/cad/types';

/**
 * Trim or extend two walls so they meet at the intersection of their centre
 * lines — Revit's Trim/Extend to Corner. The end of each wall nearer the
 * intersection is the one that moves. Returns null when the walls are
 * parallel.
 */
export function trimExtendToCorner(
    document: CadDocument,
    firstId: string,
    secondId: string,
): CadDocument | null {
    const first = findWall(document, firstId);
    const second = findWall(document, secondId);

    if (!first || !second || firstId === secondId) {
        return null;
    }

    const corner = intersectLines(
        first.a,
        normalize(subtract(first.b, first.a)),
        second.a,
        normalize(subtract(second.b, second.a)),
    );

    if (!corner) {
        return null;
    }

    const retarget = (wall: WallElement): WallElement =>
        distance(wall.a, corner) <= distance(wall.b, corner)
            ? { ...wall, a: corner }
            : { ...wall, b: corner };

    return {
        ...document,
        elements: document.elements.map((element) => {
            if (element.id === firstId && element.kind === 'wall') {
                return retarget(element);
            }

            if (element.id === secondId && element.kind === 'wall') {
                return retarget(element);
            }

            return element;
        }),
    };
}

/**
 * Split a wall at a point along it, the way Revit's Split Element does.
 *
 * Hosted doors and windows stay where they are: each opening lands on
 * whichever half contains it, with its parameter remapped. Returns null when
 * the point is too close to either end to leave two real walls.
 */
export function splitWall(
    document: CadDocument,
    wallId: string,
    at: Point,
): { document: CadDocument; createdId: string } | null {
    const wall = findWall(document, wallId);

    if (!wall) {
        return null;
    }

    const projection = projectOnSegment(at, wall.a, wall.b);
    const length = distance(wall.a, wall.b);

    if (projection.t * length < 100 || (1 - projection.t) * length < 100) {
        return null;
    }

    const cut = projection.point;
    const createdId = createId('wall');
    const secondHalf: WallElement = {
        ...wall,
        id: createdId,
        a: cut,
        b: wall.b,
    };

    const elements = document.elements.flatMap((element) => {
        if (element.id === wallId && element.kind === 'wall') {
            return [{ ...element, b: cut }, secondHalf];
        }

        if (
            (element.kind === 'door' || element.kind === 'window') &&
            element.host === wallId
        ) {
            // Remap the opening onto whichever half it falls in.
            if (element.t <= projection.t) {
                return [{ ...element, t: element.t / projection.t }];
            }

            return [
                {
                    ...element,
                    host: createdId,
                    t: (element.t - projection.t) / (1 - projection.t),
                },
            ];
        }

        return [element];
    });

    return { document: { ...document, elements }, createdId };
}

/**
 * Align one wall to another: the target becomes collinear with the reference
 * by projecting both its endpoints onto the reference's centre line.
 */
export function alignWallTo(
    document: CadDocument,
    referenceId: string,
    targetId: string,
): CadDocument | null {
    const reference = findWall(document, referenceId);
    const target = findWall(document, targetId);

    if (!reference || !target || referenceId === targetId) {
        return null;
    }

    const direction = normalize(subtract(reference.b, reference.a));

    if (direction.x === 0 && direction.y === 0) {
        return null;
    }

    const project = (p: Point): Point => {
        const relative = subtract(p, reference.a);
        const along = relative.x * direction.x + relative.y * direction.y;

        return add(reference.a, scale(direction, along));
    };

    return {
        ...document,
        elements: document.elements.map((element) =>
            element.id === targetId && element.kind === 'wall'
                ? { ...element, a: project(element.a), b: project(element.b) }
                : element,
        ),
    };
}

/**
 * Create a parallel copy of a wall offset to one side — Revit's Offset with
 * copy on. `towards` picks the side: the copy lands on whichever side of the
 * wall that point is.
 */
export function offsetWall(
    document: CadDocument,
    wallId: string,
    offsetBy: number,
    towards: Point,
): { document: CadDocument; createdId: string } | null {
    const wall = findWall(document, wallId);

    if (!wall || offsetBy <= 0) {
        return null;
    }

    const direction = normalize(subtract(wall.b, wall.a));

    if (direction.x === 0 && direction.y === 0) {
        return null;
    }

    const normal = perpendicular(direction);
    const relative = subtract(towards, wall.a);
    const side = relative.x * normal.x + relative.y * normal.y >= 0 ? 1 : -1;
    const shift = scale(normal, offsetBy * side);

    const createdId = createId('wall');
    const copy: WallElement = {
        ...wall,
        id: createdId,
        a: add(wall.a, shift),
        b: add(wall.b, shift),
    };

    return {
        document: { ...document, elements: [...document.elements, copy] },
        createdId,
    };
}

/**
 * Linear array: copy the selection `count - 1` times along `step`, so the
 * original plus copies form `count` evenly spaced instances — Revit's array
 * with "Move to: 2nd" semantics.
 */
export function linearArray(
    document: CadDocument,
    ids: string[],
    step: Point,
    count: number,
): CadDocument {
    let current = document;

    for (let index = 1; index < count; index++) {
        current = copyElements(current, ids, {
            x: step.x * index,
            y: step.y * index,
        }).document;
    }

    return current;
}
