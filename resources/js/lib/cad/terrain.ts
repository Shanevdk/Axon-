import type { Point, Terrain } from '@/lib/cad/types';

/**
 * The ground under the building.
 *
 * Terrain is a grid of spot heights rather than a drawn element: ground is
 * measured, not sketched, and every question worth asking of it — how high is
 * it here, where do the contours run, how far does it fall across the house —
 * is arithmetic on that grid. Heights are millimetres above the project
 * datum, like everything else in the model.
 *
 * Nothing here touches a canvas or a document, so it is all testable on its
 * own; `mesh.ts` turns a terrain into faces and `render-site.ts` draws it.
 */

/** Contour intervals worth drawing, in millimetres. */
const INTERVALS = [
    100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000,
];

/** Fewer lines than this reads as a blank sheet, more as a smudge. */
const FEWEST_CONTOURS = 5;
const MOST_CONTOURS = 12;

export type Bounds = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

export type Range = {
    min: number;
    max: number;
};

/** One height's worth of contour, as loose segments ready to stroke. */
export type ContourLine = {
    height: number;
    segments: [Point, Point][];
};

/**
 * A flat patch of ground, which is what a site starts as before any levels
 * have been fetched, and what the tests measure everything else against.
 */
export function flatTerrain(
    span: number,
    spacing: number,
    height = 0,
): Terrain {
    const steps = Math.max(1, Math.round(span / spacing));
    const columns = steps + 1;

    return {
        originX: -span / 2,
        originY: -span / 2,
        spacing,
        columns,
        rows: columns,
        heights: new Array(columns * columns).fill(height),
    };
}

/** The ground the grid actually covers, in model coordinates. */
export function terrainBounds(terrain: Terrain): Bounds {
    return {
        minX: terrain.originX,
        minY: terrain.originY,
        maxX: terrain.originX + (terrain.columns - 1) * terrain.spacing,
        maxY: terrain.originY + (terrain.rows - 1) * terrain.spacing,
    };
}

/** The height of one sample, clamped to the edge rather than running off it. */
export function sampleAt(terrain: Terrain, column: number, row: number): number {
    const c = clamp(Math.round(column), 0, terrain.columns - 1);
    const r = clamp(Math.round(row), 0, terrain.rows - 1);

    return terrain.heights[r * terrain.columns + c] ?? 0;
}

/**
 * The ground height at any point, interpolated between the four samples
 * around it.
 *
 * Points outside the grid clamp to its edge, so the ground continues flat
 * off the side of the survey rather than falling to zero. That is a drawing
 * decision: an elevation should not show a cliff where the data stopped.
 * Ask `coversPoint()` when the difference matters.
 */
export function heightAt(terrain: Terrain, point: Point): number {
    if (terrain.spacing <= 0 || terrain.columns < 1 || terrain.rows < 1) {
        return 0;
    }

    const gx = clamp(
        (point.x - terrain.originX) / terrain.spacing,
        0,
        terrain.columns - 1,
    );
    const gy = clamp(
        (point.y - terrain.originY) / terrain.spacing,
        0,
        terrain.rows - 1,
    );

    const c = Math.min(Math.floor(gx), terrain.columns - 1);
    const r = Math.min(Math.floor(gy), terrain.rows - 1);
    const fx = gx - c;
    const fy = gy - r;

    const bottom =
        sampleAt(terrain, c, r) * (1 - fx) + sampleAt(terrain, c + 1, r) * fx;
    const top =
        sampleAt(terrain, c, r + 1) * (1 - fx) +
        sampleAt(terrain, c + 1, r + 1) * fx;

    return bottom * (1 - fy) + top * fy;
}

/** Whether a point stands on surveyed ground rather than off its edge. */
export function coversPoint(terrain: Terrain, point: Point): boolean {
    const bounds = terrainBounds(terrain);

    return (
        point.x >= bounds.minX &&
        point.x <= bounds.maxX &&
        point.y >= bounds.minY &&
        point.y <= bounds.maxY
    );
}

/** The highest and lowest ground in the survey. */
export function heightRange(terrain: Terrain): Range {
    if (terrain.heights.length === 0) {
        return { min: 0, max: 0 };
    }

    return {
        min: Math.min(...terrain.heights),
        max: Math.max(...terrain.heights),
    };
}

/**
 * How the ground lies under a footprint.
 *
 * This is the number that decides a house: the fall from the highest corner
 * to the lowest is what you are stepping, benching or filling. Sampled at the
 * outline's own points rather than a grid, because it is the corners that
 * have to be got out of the ground.
 */
export function groundUnder(
    terrain: Terrain,
    outline: Point[],
): Range & { fall: number; average: number } {
    if (outline.length === 0) {
        return { min: 0, max: 0, fall: 0, average: 0 };
    }

    const heights = outline.map((point) => heightAt(terrain, point));
    const min = Math.min(...heights);
    const max = Math.max(...heights);

    return {
        min,
        max,
        fall: max - min,
        average: heights.reduce((sum, height) => sum + height, 0) / heights.length,
    };
}

/**
 * A contour interval that puts a readable number of lines on the sheet.
 *
 * Surveyors pick round numbers, so this walks a ladder of them rather than
 * dividing the range — 500mm contours on a gentle site, 5m on a hillside.
 */
export function contourInterval(range: Range): number {
    const fall = Math.abs(range.max - range.min);

    if (fall <= 0) {
        return INTERVALS[0];
    }

    const roomy = INTERVALS.find(
        (interval) => fall / interval <= MOST_CONTOURS,
    );

    const chosen = roomy ?? INTERVALS[INTERVALS.length - 1];

    // A very flat site would otherwise get one line through the middle.
    if (fall / chosen < FEWEST_CONTOURS) {
        const finer = [...INTERVALS]
            .reverse()
            .find((interval) => fall / interval >= FEWEST_CONTOURS);

        return finer ?? chosen;
    }

    return chosen;
}

/**
 * Contour lines through the grid, one entry per height.
 *
 * Marching squares: each cell of four samples is classified by which corners
 * stand above the contour, and the crossing points are interpolated along the
 * edges between. Segments come back loose rather than chained into polylines
 * — a stroke is a stroke, and chaining them buys nothing but a bug.
 */
export function contourLines(terrain: Terrain, interval?: number): ContourLine[] {
    const range = heightRange(terrain);
    const step = interval ?? contourInterval(range);

    if (step <= 0 || range.max - range.min < 1) {
        return [];
    }

    const lines: ContourLine[] = [];
    const first = Math.ceil(range.min / step) * step;

    for (let height = first; height <= range.max; height += step) {
        const segments = segmentsAt(terrain, height);

        if (segments.length > 0) {
            lines.push({ height, segments });
        }
    }

    return lines;
}

function segmentsAt(terrain: Terrain, height: number): [Point, Point][] {
    const segments: [Point, Point][] = [];

    for (let r = 0; r < terrain.rows - 1; r += 1) {
        for (let c = 0; c < terrain.columns - 1; c += 1) {
            crossCell(terrain, c, r, height, segments);
        }
    }

    return segments;
}

/**
 * The one or two segments crossing a single cell.
 *
 * Corners are numbered anticlockwise from the south-west, and the bit set for
 * each corner standing at or above the contour gives the case. Two of the
 * sixteen are saddles, where the contour could be drawn either way; the mean
 * of the four corners decides, which is the standard resolution and keeps
 * neighbouring cells agreeing with each other.
 */
function crossCell(
    terrain: Terrain,
    c: number,
    r: number,
    height: number,
    into: [Point, Point][],
): void {
    const bl = sampleAt(terrain, c, r);
    const br = sampleAt(terrain, c + 1, r);
    const tr = sampleAt(terrain, c + 1, r + 1);
    const tl = sampleAt(terrain, c, r + 1);

    const code =
        (bl >= height ? 1 : 0) |
        (br >= height ? 2 : 0) |
        (tr >= height ? 4 : 0) |
        (tl >= height ? 8 : 0);

    if (code === 0 || code === 15) {
        return;
    }

    const x = terrain.originX + c * terrain.spacing;
    const y = terrain.originY + r * terrain.spacing;
    const step = terrain.spacing;

    const bottom = (): Point => ({ x: x + between(bl, br, height) * step, y });
    const right = (): Point => ({
        x: x + step,
        y: y + between(br, tr, height) * step,
    });
    const top = (): Point => ({
        x: x + between(tl, tr, height) * step,
        y: y + step,
    });
    const left = (): Point => ({ x, y: y + between(bl, tl, height) * step });

    switch (code) {
        case 1:
        case 14:
            into.push([left(), bottom()]);

            return;
        case 2:
        case 13:
            into.push([bottom(), right()]);

            return;
        case 3:
        case 12:
            into.push([left(), right()]);

            return;
        case 4:
        case 11:
            into.push([right(), top()]);

            return;
        case 6:
        case 9:
            into.push([bottom(), top()]);

            return;
        case 7:
        case 8:
            into.push([left(), top()]);

            return;
        case 5:
        case 10: {
            const middle = (bl + br + tr + tl) / 4;
            const joined = middle >= height;

            if ((code === 5) === joined) {
                into.push([left(), top()], [bottom(), right()]);
            } else {
                into.push([left(), bottom()], [right(), top()]);
            }

            return;
        }
        default:
            return;
    }
}

/**
 * Where between two corners the contour crosses.
 *
 * Only ever called for an edge whose ends straddle the height, so the corners
 * genuinely differ; the guard is for grids of identical numbers reaching here
 * through rounding, where the middle is as good an answer as any.
 */
function between(from: number, to: number, height: number): number {
    const span = to - from;

    if (Math.abs(span) < 1e-9) {
        return 0.5;
    }

    return clamp((height - from) / span, 0, 1);
}

/**
 * Slide the ground under the building.
 *
 * Siting a house reads as moving the house, but the model is built around its
 * own origin and the walls should not all move because somebody dragged a
 * footprint across a map. So the terrain moves the other way instead, which
 * is the same picture and leaves every element's coordinates alone.
 */
export function moveTerrain(terrain: Terrain, dx: number, dy: number): Terrain {
    return { ...terrain, originX: terrain.originX - dx, originY: terrain.originY - dy };
}

/**
 * Lift or drop the whole survey so a point sits at a given height.
 *
 * Used to set the ground floor onto the ground: pick the level you want the
 * house to sit at and the survey shifts to meet it, rather than the model
 * being rebuilt around the numbers that came back from a satellite.
 */
export function levelTerrainTo(
    terrain: Terrain,
    point: Point,
    height: number,
): Terrain {
    const shift = height - heightAt(terrain, point);

    return {
        ...terrain,
        heights: terrain.heights.map((sample) => sample + shift),
    };
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}
