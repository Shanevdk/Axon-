/**
 * The plan as SVG.
 *
 * DXF is what another CAD program wants; this is what a page wants. Vector,
 * so it prints at any size, and openable by a browser, Illustrator, Figma or
 * a word processor — which is what a drawing pasted into a planning letter
 * or a report actually has to survive.
 *
 * The plan is drawn from the same wall and opening geometry the screen uses,
 * so what is exported is what was on the screen, mitres and all.
 */

import {
    buildOpeningGeometry,
    buildWallGeometry,
    wallsOnLevel,
} from '@/lib/cad/model';
import type {
    CadDocument,
    FloorElement,
    OpeningElement,
    Point,
    RoomElement,
} from '@/lib/cad/types';

/** The doors and windows hosted by one wall. */
function openingsFor(
    document: CadDocument,
    wallId: string,
): OpeningElement[] {
    return document.elements.filter(
        (element): element is OpeningElement =>
            (element.kind === 'door' || element.kind === 'window') &&
            element.host === wallId,
    );
}

export type SvgOptions = {
    levelId: string;
    /** Millimetres of white around the drawing. */
    margin?: number;
    name?: string;
};

const MARGIN = 500;

export function exportSvg(document: CadDocument, options: SvgOptions): string {
    const { levelId } = options;
    const margin = options.margin ?? MARGIN;

    const walls = [
        ...buildWallGeometry(document, wallsOnLevel(document, levelId)).values(),
    ];

    const floors = document.elements.filter(
        (element): element is FloorElement =>
            element.kind === 'floor' && element.level === levelId,
    );

    const rooms = document.elements.filter(
        (element): element is RoomElement =>
            element.kind === 'room' && element.level === levelId,
    );

    const everything: Point[] = [
        ...walls.flatMap((wall) => wall.polygon),
        ...floors.flatMap((floor) => floor.points),
    ];

    if (everything.length === 0) {
        return empty(options.name ?? 'plan');
    }

    const minX = Math.min(...everything.map((point) => point.x)) - margin;
    const maxX = Math.max(...everything.map((point) => point.x)) + margin;
    const minY = Math.min(...everything.map((point) => point.y)) - margin;
    const maxY = Math.max(...everything.map((point) => point.y)) + margin;

    const width = maxX - minX;
    const height = maxY - minY;

    /*
     * Plan y runs north and SVG y runs down the page, so the whole drawing is
     * flipped once here rather than every coordinate being negated at the
     * point of use — which is the version that eventually gets one wrong.
     */
    const body: string[] = [];

    floors.forEach((floor) => {
        body.push(
            `<polygon points="${points(floor.points)}" fill="#f3f0ea" stroke="none"/>`,
        );
    });

    walls.forEach((wall) => {
        body.push(
            `<polygon points="${points(wall.polygon)}" fill="#2b2926" stroke="none"/>`,
        );
    });

    // The openings are cut back out of the poché, which is what makes a
    // doorway read as a way through rather than as solid wall.
    walls.forEach((wall) => {
        openingsFor(document, wall.wall.id).forEach((opening) => {
            const geometry = buildOpeningGeometry(document, opening, wall);

            body.push(
                `<polygon points="${points(geometry.polygon)}" fill="#ffffff" stroke="none"/>`,
            );

            if (opening.kind === 'window') {
                // A line of glass across the reveal.
                body.push(
                    `<line x1="${round(geometry.jambA.x)}" y1="${round(-geometry.jambA.y)}" x2="${round(geometry.jambB.x)}" y2="${round(-geometry.jambB.y)}" stroke="#2b2926" stroke-width="20"/>`,
                );
            }
        });
    });

    rooms.forEach((room) => {
        body.push(
            `<text x="${round(room.p.x)}" y="${round(-room.p.y)}" font-family="sans-serif" font-size="220" text-anchor="middle" fill="#2b2926">${escapeXml(room.name)}</text>`,
        );
    });

    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}mm" height="${round(height)}mm" viewBox="${round(minX)} ${round(-maxY)} ${round(width)} ${round(height)}">
  <title>${escapeXml(options.name ?? 'Plan')}</title>
  <rect x="${round(minX)}" y="${round(-maxY)}" width="${round(width)}" height="${round(height)}" fill="#ffffff"/>
${body.map((line) => `  ${line}`).join('\n')}
</svg>
`;
}

function empty(name: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">
  <title>${escapeXml(name)}</title>
</svg>
`;
}

function points(polygon: Point[]): string {
    return polygon
        .map((point) => `${round(point.x)},${round(-point.y)}`)
        .join(' ');
}

function round(value: number): string {
    return String(Math.round(value * 100) / 100);
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
