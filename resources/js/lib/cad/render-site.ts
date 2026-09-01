import { worldToScreen } from '@/lib/cad/render-plan';
import type { Viewport } from '@/lib/cad/render-plan';
import {
    contourInterval,
    contourLines,
    groundUnder,
    heightAt,
    heightRange,
    terrainBounds,
} from '@/lib/cad/terrain';
import { CAD_THEME } from '@/lib/cad/theme';
import type { Point, Site, Units } from '@/lib/cad/types';
import { formatLength } from '@/lib/cad/units';

/**
 * The site plan: the ground of the property, and the house standing on it.
 *
 * This is the one view drawn from the terrain grid rather than from elements,
 * because the ground is measured rather than drawn. The building appears as
 * its footprint alone — you are siting it, not detailing it — and dragging it
 * across the contours is the whole point of the view.
 */

/** Every fifth contour is drawn heavier and labelled, as on a survey. */
const INDEX_CONTOUR = 5;

/** Below this on screen the contours are a smudge, so they are dropped. */
const CONTOURS_WORTH_DRAWING = 3;

const LEGEND_WIDTH = 226;

export type SiteScene = {
    site: Site | null;
    /** Wall footprints on the lowest level, in model coordinates. */
    footprint: Point[][];
    /** Any property boundary drawn into the model. */
    propertyLines: Point[][];
    units: Units;
    /** True while the building is being dragged onto its spot. */
    siting: boolean;
};

export function drawSite(
    ctx: CanvasRenderingContext2D,
    scene: SiteScene,
    viewport: Viewport,
): void {
    const toScreen = (point: Point) => worldToScreen(point, viewport);

    ctx.save();
    ctx.fillStyle = CAD_THEME.paper;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const terrain = scene.site?.terrain ?? null;

    if (terrain) {
        drawSurveyed(ctx, terrain, toScreen);
        drawContours(ctx, terrain, scene.units, viewport, toScreen);
    }

    scene.propertyLines.forEach((points) => {
        drawBoundary(ctx, points, toScreen);
    });

    drawFootprint(ctx, scene, toScreen);

    if (terrain) {
        drawSpotHeights(ctx, scene, toScreen);
    }

    drawLegend(ctx, scene, viewport);
    ctx.restore();
}

/** The patch that was actually measured, so its edge is never a surprise. */
function drawSurveyed(
    ctx: CanvasRenderingContext2D,
    terrain: NonNullable<Site['terrain']>,
    toScreen: (point: Point) => Point,
): void {
    const bounds = terrainBounds(terrain);
    const from = toScreen({ x: bounds.minX, y: bounds.maxY });
    const to = toScreen({ x: bounds.maxX, y: bounds.minY });

    ctx.save();
    ctx.fillStyle = CAD_THEME.topoFill;
    ctx.fillRect(from.x, from.y, to.x - from.x, to.y - from.y);

    ctx.strokeStyle = CAD_THEME.inkFaint;
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1;
    ctx.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y);
    ctx.restore();
}

function drawContours(
    ctx: CanvasRenderingContext2D,
    terrain: NonNullable<Site['terrain']>,
    units: Units,
    viewport: Viewport,
    toScreen: (point: Point) => Point,
): void {
    const range = heightRange(terrain);
    const interval = contourInterval(range);

    // Zoomed far out the lines would sit on top of each other and read as a
    // grey wash, which is worse than nothing.
    if (interval * viewport.camera.zoom < CONTOURS_WORTH_DRAWING) {
        return;
    }

    const lines = contourLines(terrain, interval);

    ctx.save();
    ctx.lineCap = 'round';

    lines.forEach((line) => {
        const index = Math.round(line.height / interval) % INDEX_CONTOUR === 0;

        ctx.strokeStyle = CAD_THEME.topo;
        ctx.globalAlpha = index ? 1 : 0.55;
        ctx.lineWidth = index ? 1.6 : 0.9;

        ctx.beginPath();
        line.segments.forEach(([from, to]) => {
            const a = toScreen(from);
            const b = toScreen(to);

            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        });
        ctx.stroke();

        if (index) {
            labelContour(ctx, line.segments, line.height, units, toScreen);
        }
    });

    ctx.restore();
}

/**
 * A height written along the contour it belongs to.
 *
 * One label per line, on the middle segment, which is the cheapest way to
 * land it somewhere near the middle of the drawing rather than out at an edge
 * where it would be cropped.
 */
function labelContour(
    ctx: CanvasRenderingContext2D,
    segments: [Point, Point][],
    height: number,
    units: Units,
    toScreen: (point: Point) => Point,
): void {
    const middle = segments[Math.floor(segments.length / 2)];

    if (!middle) {
        return;
    }

    const at = toScreen({
        x: (middle[0].x + middle[1].x) / 2,
        y: (middle[0].y + middle[1].y) / 2,
    });

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = '10px Karla, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = formatLength(height, units);
    const width = ctx.measureText(text).width + 6;

    ctx.fillStyle = CAD_THEME.paper;
    ctx.fillRect(at.x - width / 2, at.y - 7, width, 14);
    ctx.fillStyle = CAD_THEME.topo;
    ctx.fillText(text, at.x, at.y);
    ctx.restore();
}

function drawBoundary(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    toScreen: (point: Point) => Point,
): void {
    if (points.length < 2) {
        return;
    }

    ctx.save();
    ctx.strokeStyle = CAD_THEME.propertyLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 4, 3, 4]);

    ctx.beginPath();
    points.forEach((point, index) => {
        const at = toScreen(point);

        if (index === 0) {
            ctx.moveTo(at.x, at.y);
        } else {
            ctx.lineTo(at.x, at.y);
        }
    });
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
}

/** The house, as the shape it takes up on the ground. */
function drawFootprint(
    ctx: CanvasRenderingContext2D,
    scene: SiteScene,
    toScreen: (point: Point) => Point,
): void {
    ctx.save();
    ctx.fillStyle = scene.siting
        ? CAD_THEME.highlightFill
        : 'rgba(36, 36, 36, 0.55)';
    ctx.strokeStyle = scene.siting ? CAD_THEME.highlight : CAD_THEME.ink;
    ctx.lineWidth = scene.siting ? 2 : 1.2;

    scene.footprint.forEach((polygon) => {
        if (polygon.length < 3) {
            return;
        }

        ctx.beginPath();
        polygon.forEach((point, index) => {
            const at = toScreen(point);

            if (index === 0) {
                ctx.moveTo(at.x, at.y);
            } else {
                ctx.lineTo(at.x, at.y);
            }
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    });

    ctx.restore();
}

/**
 * The ground level at each corner of the building.
 *
 * These are the numbers somebody actually works from: how far each corner is
 * above or below the ground floor is what decides the steps, the fill and
 * where the water goes.
 */
function drawSpotHeights(
    ctx: CanvasRenderingContext2D,
    scene: SiteScene,
    toScreen: (point: Point) => Point,
): void {
    const terrain = scene.site?.terrain;

    if (!terrain) {
        return;
    }

    ctx.save();
    ctx.font = '10px Karla, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    cornersOf(scene.footprint).forEach((corner) => {
        const at = toScreen(corner);
        const height = heightAt(terrain, corner);

        ctx.fillStyle = CAD_THEME.datum;
        ctx.beginPath();
        ctx.arc(at.x, at.y, 2.5, 0, Math.PI * 2);
        ctx.fill();

        const text = `${height >= 0 ? '+' : '−'}${formatLength(
            Math.abs(height),
            scene.units,
        )}`;

        ctx.fillStyle = CAD_THEME.paper;
        ctx.fillRect(at.x + 5, at.y - 7, ctx.measureText(text).width + 6, 14);
        ctx.fillStyle = CAD_THEME.datum;
        ctx.fillText(text, at.x + 8, at.y);
    });

    ctx.restore();
}

/**
 * The outermost corners of the building.
 *
 * Every wall corner would bury the drawing in numbers, so this takes the
 * four extremes of the whole footprint — which are the corners that decide
 * how the house sits, and the ones a builder would peg out first.
 */
function cornersOf(footprint: Point[][]): Point[] {
    const points = footprint.flat();

    if (points.length === 0) {
        return [];
    }

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
    ];
}

/**
 * What the drawing is standing on, said in words.
 *
 * The fall under the house is the number that matters, and the source is
 * there because ground read off a terrain model is not a survey — anybody
 * reading this drawing is entitled to know which of the two they have.
 */
function drawLegend(
    ctx: CanvasRenderingContext2D,
    scene: SiteScene,
    viewport: Viewport,
): void {
    const terrain = scene.site?.terrain ?? null;

    const lines: string[] = [];

    if (!terrain) {
        lines.push(
            'No ground levels yet.',
            'Site → Ground Levels to measure the property.',
        );
    } else {
        const range = heightRange(terrain);
        const under = groundUnder(terrain, cornersOf(scene.footprint));

        lines.push(
            `Contours at ${formatLength(contourInterval(range), scene.units)}`,
            `Site falls ${formatLength(range.max - range.min, scene.units)}`,
        );

        if (scene.footprint.length > 0) {
            lines.push(
                `Under the house ${formatLength(under.fall, scene.units)}`,
                `Lowest corner ${under.min >= 0 ? '+' : '−'}${formatLength(
                    Math.abs(under.min),
                    scene.units,
                )}`,
            );
        }

        if (scene.site?.source) {
            lines.push(scene.site.source, 'Not a survey.');
        }
    }

    const height = 16 + lines.length * 15;
    const x = 14;
    const y = viewport.height - height - 14;

    ctx.save();
    ctx.fillStyle = 'rgba(247, 245, 242, 0.92)';
    ctx.strokeStyle = CAD_THEME.inkFaint;
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, LEGEND_WIDTH, height);
    ctx.strokeRect(x, y, LEGEND_WIDTH, height);

    ctx.font = '11px Karla, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    lines.forEach((line, index) => {
        const last = index === lines.length - 1;

        ctx.fillStyle =
            last && line === 'Not a survey.'
                ? CAD_THEME.revision
                : CAD_THEME.inkSoft;
        ctx.fillText(line, x + 10, y + 14 + index * 15);
    });

    ctx.restore();
}
