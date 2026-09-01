/**
 * Walking a house on foot.
 *
 * The editor's walk mode is a camera that goes where it is pointed, which is
 * what a designer wants — through a wall to look at a junction. A client
 * walking their own house wants the opposite: to be stopped by the walls and
 * to go through the doors. That is all this is. It works in plan, in
 * millimetres, against one level at a time; stairs are not climbed, the
 * portal moves the walker between levels instead.
 */

import { openingSize, wallsOnLevel } from '@/lib/cad/model';
import type {
    CadDocument,
    DoorElement,
    Level,
    Point,
    WalkCamera,
} from '@/lib/cad/types';

/** Half the width of a person, in millimetres. */
export const SHOULDER = 250;

/** Height of the eye above the floor, in millimetres. */
export const EYE_HEIGHT = 1600;

/** Fallback wall thickness when a wall's type has gone missing. */
const ASSUMED_THICKNESS = 200;

/**
 * One wall, as something to bump into.
 */
export type Barrier = {
    a: Point;
    b: Point;
    /** Distance from the centre line to the wall face, in millimetres. */
    half: number;
    /** Length of the wall, in millimetres. */
    length: number;
    /** Openings a person fits through, as arc-length ranges from `a`. */
    gaps: { from: number; to: number }[];
};

/**
 * Turn one level's walls into barriers, with doorways left open.
 *
 * Windows are not gaps: a window you could walk through is a door.
 */
export function wallBarriers(
    document: CadDocument,
    levelId: string,
): Barrier[] {
    const types = new Map(document.wallTypes.map((type) => [type.id, type]));

    const doorsByHost = new Map<string, DoorElement[]>();

    for (const element of document.elements) {
        if (element.kind !== 'door') {
            continue;
        }

        const hosted = doorsByHost.get(element.host) ?? [];
        hosted.push(element);
        doorsByHost.set(element.host, hosted);
    }

    return wallsOnLevel(document, levelId).map((wall) => {
        const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);

        const gaps = (doorsByHost.get(wall.id) ?? []).map((door) => {
            const { width } = openingSize(document, door);
            const centre = door.t * length;

            return { from: centre - width / 2, to: centre + width / 2 };
        });

        return {
            a: wall.a,
            b: wall.b,
            half: (types.get(wall.typeId)?.thickness ?? ASSUMED_THICKNESS) / 2,
            length,
            gaps,
        };
    });
}

/**
 * Where a step actually ends up once the walls have had their say.
 *
 * Each barrier pushes the walker back out to its face rather than cancelling
 * the step, so walking into a wall at an angle slides along it instead of
 * stopping dead. Two passes, so an inside corner — where being pushed off one
 * wall can bury you in the other — settles.
 */
export function slideAlongWalls(
    barriers: Barrier[],
    target: Point,
    radius: number = SHOULDER,
): Point {
    let point = target;

    for (let pass = 0; pass < 2; pass++) {
        for (const barrier of barriers) {
            point = pushOut(barrier, point, radius);
        }
    }

    return point;
}

function pushOut(barrier: Barrier, point: Point, radius: number): Point {
    const dx = barrier.b.x - barrier.a.x;
    const dy = barrier.b.y - barrier.a.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return point;
    }

    const t = Math.min(
        Math.max(
            ((point.x - barrier.a.x) * dx + (point.y - barrier.a.y) * dy) /
                lengthSquared,
            0,
        ),
        1,
    );

    const closest = { x: barrier.a.x + t * dx, y: barrier.a.y + t * dy };
    const along = t * barrier.length;

    // A doorway is a hole in the wall, and the walker goes through it.
    if (barrier.gaps.some((gap) => along >= gap.from && along <= gap.to)) {
        return point;
    }

    const clearance = barrier.half + radius;
    let offsetX = point.x - closest.x;
    let offsetY = point.y - closest.y;
    let distance = Math.hypot(offsetX, offsetY);

    if (distance >= clearance) {
        return point;
    }

    if (distance < 1e-6) {
        // Standing exactly on the centre line, with no side to be pushed
        // towards. Step off square to the wall and let the next pass settle it.
        const length = Math.sqrt(lengthSquared);
        offsetX = -dy / length;
        offsetY = dx / length;
        distance = 1;
    } else {
        offsetX /= distance;
        offsetY /= distance;
    }

    return {
        x: closest.x + offsetX * clearance,
        y: closest.y + offsetY * clearance,
    };
}

/**
 * Somewhere sensible to be standing when the walk begins.
 *
 * The middle of the level's walls, nudged out of anything it lands inside,
 * facing whichever way puts most of the building in front of the walker.
 */
export function startingPose(
    document: CadDocument,
    level: Level,
    barriers: Barrier[],
): WalkCamera {
    const walls = wallsOnLevel(document, level.id);

    const points = walls.flatMap((wall) => [wall.a, wall.b]);

    const centre =
        points.length === 0
            ? { x: 0, y: 0 }
            : {
                  x:
                      points.reduce((total, point) => total + point.x, 0) /
                      points.length,
                  y:
                      points.reduce((total, point) => total + point.y, 0) /
                      points.length,
              };

    const standing = slideAlongWalls(barriers, centre);

    return {
        eye: {
            x: standing.x,
            y: standing.y,
            z: level.elevation + EYE_HEIGHT,
        },
        // Facing north-east reads as a three-quarter view of most plans, which
        // beats staring at whichever wall happens to lie due east.
        yaw: Math.PI / 4,
        pitch: 0,
    };
}

/**
 * Longest distance a walker may be moved before the walls are consulted.
 *
 * `slideAlongWalls` only knows whether a point is inside a wall, so a step
 * longer than a wall is thick clears it in one go and the walker ends up
 * outside their own house. Keeping each sub-step shorter than the thinnest
 * clearance means no wall can be jumped without landing in it first.
 */
const SWEEP = 100;

/**
 * Move the eye, in the direction it is facing, with the walls enforced.
 *
 * `forward` and `strafe` are in millimetres for this step; the caller scales
 * them by the frame time so walking speed does not follow the frame rate.
 * The move is swept rather than taken in one jump, so a slow frame does not
 * put the client through a wall.
 */
export function stepWalker(
    walk: WalkCamera,
    barriers: Barrier[],
    forward: number,
    strafe: number,
): WalkCamera {
    if (forward === 0 && strafe === 0) {
        return walk;
    }

    const sin = Math.sin(walk.yaw);
    const cos = Math.cos(walk.yaw);
    const dx = cos * forward + sin * strafe;
    const dy = sin * forward - cos * strafe;

    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / SWEEP));

    let position: Point = { x: walk.eye.x, y: walk.eye.y };

    for (let step = 0; step < steps; step++) {
        position = slideAlongWalls(barriers, {
            x: position.x + dx / steps,
            y: position.y + dy / steps,
        });
    }

    return {
        ...walk,
        eye: { x: position.x, y: position.y, z: walk.eye.z },
    };
}

/** Keep the pitch inside a neck's range, so the view never turns over. */
export function clampPitch(pitch: number): number {
    const limit = Math.PI / 2 - 0.05;

    return Math.min(Math.max(pitch, -limit), limit);
}
