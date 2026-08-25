import {
    add,
    distance,
    intersectSegments,
    midpoint,
    normalize,
    projectOnSegment,
    roundTo,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import type { WallGeometry } from '@/lib/cad/model';
import type { Point, SnapKind, SnapResult } from '@/lib/cad/types';

export const SNAP_LABELS: Record<SnapKind, string> = {
    endpoint: 'Endpoint',
    midpoint: 'Midpoint',
    intersection: 'Intersection',
    perpendicular: 'Perpendicular',
    nearest: 'Nearest',
    grid: 'Grid',
    ortho: 'Orthogonal',
    free: '',
};

/** Lower numbers win when two snaps are within tolerance of each other. */
const PRIORITY: Record<SnapKind, number> = {
    endpoint: 0,
    intersection: 1,
    midpoint: 2,
    perpendicular: 3,
    nearest: 4,
    grid: 5,
    ortho: 6,
    free: 7,
};

export type SnapSettings = Record<Exclude<SnapKind, 'ortho' | 'free'>, boolean>;

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
    endpoint: true,
    midpoint: true,
    intersection: true,
    perpendicular: true,
    nearest: false,
    grid: true,
};

export type SnapContext = {
    walls: WallGeometry[];
    settings: SnapSettings;
    /** Snap radius in model units, derived from the zoom level. */
    tolerance: number;
    gridSize: number;
    /** Rounding applied to unsnapped points, e.g. 10mm or one inch. */
    increment: number;
    /** Previous point of the current operation, needed for ortho and perpendicular. */
    base?: Point | null;
    ortho: boolean;
};

/**
 * Resolve the cursor position to the point the user actually means.
 *
 * Object snaps win over the grid, and an ortho lock is only overridden by a
 * snap that happens to sit on the locked axis.
 */
export function resolveSnap(world: Point, context: SnapContext): SnapResult {
    const nearby = wallsNear(context.walls, world, context.tolerance * 8);
    const candidates = collectCandidates(world, nearby, context);

    const best = candidates
        .filter(
            (candidate) =>
                distance(candidate.point, world) <= context.tolerance,
        )
        .sort((a, b) => {
            const byPriority = PRIORITY[a.kind] - PRIORITY[b.kind];

            return byPriority !== 0
                ? byPriority
                : distance(a.point, world) - distance(b.point, world);
        })[0];

    if (context.ortho && context.base) {
        const locked = applyOrtho(world, context.base, context.increment);

        if (best && distance(best.point, locked) <= context.tolerance) {
            return best;
        }

        return { point: locked, kind: 'ortho' };
    }

    if (best) {
        return best;
    }

    return {
        point: {
            x: roundTo(world.x, context.increment),
            y: roundTo(world.y, context.increment),
        },
        kind: 'free',
    };
}

function wallsNear(
    walls: WallGeometry[],
    world: Point,
    radius: number,
): WallGeometry[] {
    return walls.filter(
        (wall) => projectOnSegment(world, wall.a, wall.b).distance <= radius,
    );
}

function collectCandidates(
    world: Point,
    walls: WallGeometry[],
    context: SnapContext,
): SnapResult[] {
    const candidates: SnapResult[] = [];
    const { settings } = context;

    walls.forEach((wall) => {
        if (settings.endpoint) {
            candidates.push({
                point: wall.a,
                kind: 'endpoint',
                reference: wall.wall.id,
            });
            candidates.push({
                point: wall.b,
                kind: 'endpoint',
                reference: wall.wall.id,
            });
        }

        if (settings.midpoint) {
            candidates.push({
                point: midpoint(wall.a, wall.b),
                kind: 'midpoint',
                reference: wall.wall.id,
            });
        }

        if (settings.nearest) {
            candidates.push({
                point: projectOnSegment(world, wall.a, wall.b).point,
                kind: 'nearest',
                reference: wall.wall.id,
            });
        }

        if (settings.perpendicular && context.base) {
            const foot = projectOnSegment(context.base, wall.a, wall.b);

            candidates.push({
                point: projectOnSegment(foot.point, wall.a, wall.b).point,
                kind: 'perpendicular',
                reference: wall.wall.id,
            });
        }
    });

    if (settings.intersection) {
        for (let i = 0; i < walls.length; i++) {
            for (let j = i + 1; j < walls.length; j++) {
                const crossing = intersectSegments(
                    walls[i].a,
                    walls[i].b,
                    walls[j].a,
                    walls[j].b,
                );

                if (crossing) {
                    candidates.push({ point: crossing, kind: 'intersection' });
                }
            }
        }
    }

    if (settings.grid && context.gridSize > 0) {
        candidates.push({
            point: {
                x: roundTo(world.x, context.gridSize),
                y: roundTo(world.y, context.gridSize),
            },
            kind: 'grid',
        });
    }

    return candidates;
}

/** Lock to the nearer of the horizontal and vertical axes through `base`. */
function applyOrtho(world: Point, base: Point, increment: number): Point {
    const dx = world.x - base.x;
    const dy = world.y - base.y;

    return Math.abs(dx) >= Math.abs(dy)
        ? { x: base.x + roundTo(dx, increment), y: base.y }
        : { x: base.x, y: base.y + roundTo(dy, increment) };
}

/**
 * Snap a direction to the nearest 15 degree increment, used while rotating.
 */
export function snapAngle(radians: number, step = Math.PI / 12): number {
    return Math.round(radians / step) * step;
}

/**
 * Move a point along `direction` so it sits exactly `length` from `origin` —
 * how a typed dimension override is applied while drawing a wall.
 */
export function pointAtDistance(
    origin: Point,
    towards: Point,
    length: number,
): Point {
    const direction = normalize(subtract(towards, origin));

    if (direction.x === 0 && direction.y === 0) {
        return { ...origin };
    }

    return add(origin, scale(direction, length));
}
