import {
    boundsOf,
    expandBounds,
    polygonArea,
    polygonPerimeter,
    projectOnSegment,
    removeCollinear,
    simplifyPolyline,
} from '@/lib/cad/geometry';
import type { WallGeometry } from '@/lib/cad/model';
import type { Point, RoomElement } from '@/lib/cad/types';

export type RoomBoundary = {
    polygon: Point[];
    area: number;
    perimeter: number;
};

/** Cell size of the occupancy grid, in millimetres. */
const CELL = 40;

/** Upper bound on grid cells so a very large model degrades resolution instead of stalling. */
const MAX_CELLS = 400_000;

type Grid = {
    originX: number;
    originY: number;
    cell: number;
    width: number;
    height: number;
    blocked: Uint8Array;
};

/**
 * Compute the enclosed boundary of every room tag on a level.
 *
 * Rooms are found the way a paint bucket would: the wall footprints are burnt
 * into an occupancy grid, the area around each room tag is flood filled, and
 * the outline of the filled cells is traced back into a polygon. A tag that
 * leaks to the edge of the model is reported as not enclosed, exactly like
 * Revit's "Room Not Enclosed" warning.
 */
export function computeRoomBoundaries(
    rooms: RoomElement[],
    walls: WallGeometry[],
): Map<string, RoomBoundary> {
    const result = new Map<string, RoomBoundary>();

    if (rooms.length === 0 || walls.length === 0) {
        return result;
    }

    const grid = buildGrid(walls);

    if (!grid) {
        return result;
    }

    const region = new Int32Array(grid.width * grid.height).fill(-1);
    const cache = new Map<number, RoomBoundary>();

    rooms.forEach((room, index) => {
        const seed = seedCell(grid, room.p);

        if (seed === null) {
            return;
        }

        const existing = region[seed];

        if (existing >= 0) {
            const cached = cache.get(existing);

            if (cached) {
                result.set(room.id, cached);
            }

            return;
        }

        const cells = floodFill(grid, seed, region, index);

        if (!cells) {
            return;
        }

        const polygon = traceOutline(grid, cells);

        if (polygon.length < 3) {
            return;
        }

        const boundary: RoomBoundary = {
            polygon,
            area: polygonArea(polygon),
            perimeter: polygonPerimeter(polygon),
        };

        cache.set(index, boundary);
        result.set(room.id, boundary);
    });

    return result;
}

function buildGrid(walls: WallGeometry[]): Grid | null {
    const bounds = boundsOf(walls.flatMap((wall) => wall.polygon));

    if (!bounds) {
        return null;
    }

    const padded = expandBounds(bounds, CELL * 4);
    const spanX = padded.maxX - padded.minX;
    const spanY = padded.maxY - padded.minY;
    const cell = Math.max(CELL, Math.sqrt((spanX * spanY) / MAX_CELLS));
    const width = Math.ceil(spanX / cell) + 1;
    const height = Math.ceil(spanY / cell) + 1;

    const grid: Grid = {
        originX: padded.minX,
        originY: padded.minY,
        cell,
        width,
        height,
        blocked: new Uint8Array(width * height),
    };

    walls.forEach((wall) => burnWall(grid, wall));

    return grid;
}

/**
 * Mark every cell whose centre falls inside the wall body. Cells are smaller
 * than the thinnest partition, so a wall always leaves an unbroken line of
 * blocked cells and the flood fill cannot leak through it.
 */
function burnWall(grid: Grid, wall: WallGeometry): void {
    const half = wall.thickness / 2;
    const minX = Math.min(wall.a.x, wall.b.x) - half - grid.cell;
    const maxX = Math.max(wall.a.x, wall.b.x) + half + grid.cell;
    const minY = Math.min(wall.a.y, wall.b.y) - half - grid.cell;
    const maxY = Math.max(wall.a.y, wall.b.y) + half + grid.cell;

    const fromX = clampIndex(
        Math.floor((minX - grid.originX) / grid.cell),
        grid.width,
    );
    const toX = clampIndex(
        Math.ceil((maxX - grid.originX) / grid.cell),
        grid.width,
    );
    const fromY = clampIndex(
        Math.floor((minY - grid.originY) / grid.cell),
        grid.height,
    );
    const toY = clampIndex(
        Math.ceil((maxY - grid.originY) / grid.cell),
        grid.height,
    );

    for (let j = fromY; j <= toY; j++) {
        for (let i = fromX; i <= toX; i++) {
            const centre = {
                x: grid.originX + (i + 0.5) * grid.cell,
                y: grid.originY + (j + 0.5) * grid.cell,
            };

            if (projectOnSegment(centre, wall.a, wall.b).distance <= half) {
                grid.blocked[j * grid.width + i] = 1;
            }
        }
    }
}

function clampIndex(value: number, limit: number): number {
    return Math.min(Math.max(value, 0), limit - 1);
}

function seedCell(grid: Grid, p: Point): number | null {
    const i = Math.floor((p.x - grid.originX) / grid.cell);
    const j = Math.floor((p.y - grid.originY) / grid.cell);

    if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) {
        return null;
    }

    if (grid.blocked[j * grid.width + i] === 0) {
        return j * grid.width + i;
    }

    // Nudge off a wall the tag happens to sit on.
    for (let radius = 1; radius <= 3; radius++) {
        for (let dj = -radius; dj <= radius; dj++) {
            for (let di = -radius; di <= radius; di++) {
                const ni = i + di;
                const nj = j + dj;

                if (ni < 0 || nj < 0 || ni >= grid.width || nj >= grid.height) {
                    continue;
                }

                if (grid.blocked[nj * grid.width + ni] === 0) {
                    return nj * grid.width + ni;
                }
            }
        }
    }

    return null;
}

/**
 * Four-connected flood fill. Returns null when the fill escapes to the edge of
 * the grid, which means the tag is not inside a closed set of walls.
 */
function floodFill(
    grid: Grid,
    seed: number,
    region: Int32Array,
    index: number,
): Set<number> | null {
    const cells = new Set<number>();
    const marked: number[] = [seed];
    const queue: number[] = [seed];
    region[seed] = index;

    const abandon = (): null => {
        marked.forEach((cellIndex) => {
            region[cellIndex] = -1;
        });

        return null;
    };

    while (queue.length > 0) {
        const cellIndex = queue.pop() as number;
        const i = cellIndex % grid.width;
        const j = Math.floor(cellIndex / grid.width);

        if (
            i === 0 ||
            j === 0 ||
            i === grid.width - 1 ||
            j === grid.height - 1
        ) {
            return abandon();
        }

        cells.add(cellIndex);

        const neighbours = [
            cellIndex - 1,
            cellIndex + 1,
            cellIndex - grid.width,
            cellIndex + grid.width,
        ];

        for (const neighbour of neighbours) {
            if (neighbour < 0 || neighbour >= grid.blocked.length) {
                return abandon();
            }

            if (grid.blocked[neighbour] === 1 || region[neighbour] === index) {
                continue;
            }

            region[neighbour] = index;
            marked.push(neighbour);
            queue.push(neighbour);
        }
    }

    return cells;
}

type Corner = { i: number; j: number };

/**
 * Walk the boundary of the filled cells and simplify the staircase back into
 * straight wall faces.
 */
function traceOutline(grid: Grid, cells: Set<number>): Point[] {
    const edges = new Map<string, Corner[]>();

    const addEdge = (from: Corner, to: Corner): void => {
        const key = cornerKey(from);
        const bucket = edges.get(key) ?? [];
        bucket.push(to);
        edges.set(key, bucket);
    };

    cells.forEach((cellIndex) => {
        const i = cellIndex % grid.width;
        const j = Math.floor(cellIndex / grid.width);

        // Emitted counter-clockwise so the filled area stays on the left.
        if (!cells.has(cellIndex - grid.width)) {
            addEdge({ i, j }, { i: i + 1, j });
        }

        if (!cells.has(cellIndex + 1)) {
            addEdge({ i: i + 1, j }, { i: i + 1, j: j + 1 });
        }

        if (!cells.has(cellIndex + grid.width)) {
            addEdge({ i: i + 1, j: j + 1 }, { i, j: j + 1 });
        }

        if (!cells.has(cellIndex - 1)) {
            addEdge({ i, j: j + 1 }, { i, j });
        }
    });

    let best: Point[] = [];
    let bestArea = 0;

    while (edges.size > 0) {
        const startKey = edges.keys().next().value as string;
        const loop = walkLoop(edges, startKey);

        if (loop.length < 4) {
            edges.delete(startKey);

            continue;
        }

        const polygon = loop.map((corner) => ({
            x: grid.originX + corner.i * grid.cell,
            y: grid.originY + corner.j * grid.cell,
        }));
        const area = polygonArea(polygon);

        if (area > bestArea) {
            bestArea = area;
            best = polygon;
        }
    }

    if (best.length < 3) {
        return [];
    }

    const trimmed = removeCollinear(best, grid.cell * 0.25);
    const simplified = simplifyPolyline(
        [...trimmed, trimmed[0]],
        grid.cell * 1.2,
    );

    return removeCollinear(simplified.slice(0, -1), grid.cell * 0.25);
}

function walkLoop(edges: Map<string, Corner[]>, startKey: string): Corner[] {
    const loop: Corner[] = [];
    let key = startKey;
    let guard = 0;

    while (guard++ < 200_000) {
        const bucket = edges.get(key);

        if (!bucket || bucket.length === 0) {
            break;
        }

        const next = bucket.pop() as Corner;

        if (bucket.length === 0) {
            edges.delete(key);
        }

        loop.push(next);
        key = cornerKey(next);

        if (key === startKey) {
            break;
        }
    }

    return loop;
}

function cornerKey(corner: Corner): string {
    return `${corner.i},${corner.j}`;
}
