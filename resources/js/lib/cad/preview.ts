/**
 * What the server is allowed to keep.
 *
 * Drawings live on the machine that made them, so the database holds only
 * enough to list a project and draw its thumbnail: one level of plan geometry
 * and a handful of counts. Both are computed here, from the full document, so
 * the numbers on the projects page stay true to the whole model even though
 * the server never sees it.
 */

import type { CadDocument, CadElement, MeshElement } from '@/lib/cad/types';

/** Kinds the plan thumbnail actually draws. */
const DRAWABLE = ['wall', 'door', 'window', 'floor', 'room', 'mesh'] as const;

/** Counts shown on the projects page and totalled on the dashboard. */
export type DocumentSummary = {
    levels: number;
    walls: number;
    rooms: number;
    openings: number;
    /** Total wall centre line length, in millimetres. */
    wallLength: number;
    /** Combined floor slab area, in square millimetres. */
    slabArea: number;
};

/**
 * Reduce a model to the single level worth previewing.
 *
 * An imported mesh can carry tens of thousands of vertices and the thumbnail
 * only draws its footprint, so the triangles are stripped out on the way.
 * Returns null when there is nothing drawn to preview.
 */
export function buildPreview(document: CadDocument): CadDocument | null {
    const level = busiestLevel(document);

    if (!level) {
        return null;
    }

    const elements = document.elements
        .filter(
            (element) =>
                element.level === level &&
                (DRAWABLE as readonly string[]).includes(element.kind),
        )
        .map((element) =>
            element.kind === 'mesh'
                ? ({ ...(element as MeshElement), vertices: [] } as CadElement)
                : element,
        );

    if (elements.length === 0) {
        return null;
    }

    return {
        version: document.version,
        units: document.units,
        levels: document.levels.filter((item) => item.id === level),
        wallTypes: document.wallTypes,
        doorTypes: document.doorTypes,
        windowTypes: document.windowTypes,
        elements,
        viewSettings: {},
    };
}

/**
 * Count the whole model, not just the previewed level.
 */
export function summarise(document: CadDocument): DocumentSummary {
    const countOf = (...kinds: string[]): number =>
        document.elements.filter((element) => kinds.includes(element.kind))
            .length;

    let wallLength = 0;
    let slabArea = 0;

    for (const element of document.elements) {
        if (element.kind === 'wall') {
            wallLength += Math.hypot(
                element.b.x - element.a.x,
                element.b.y - element.a.y,
            );
        }

        if (element.kind === 'floor') {
            slabArea += polygonArea(element.points);
        }
    }

    return {
        levels: document.levels.length,
        walls: countOf('wall'),
        rooms: countOf('room'),
        openings: countOf('door', 'window'),
        wallLength,
        slabArea,
    };
}

/**
 * The level carrying the most drawable geometry — the one worth showing.
 */
function busiestLevel(document: CadDocument): string | null {
    const counts = new Map<string, number>();

    for (const element of document.elements) {
        if (!(DRAWABLE as readonly string[]).includes(element.kind)) {
            continue;
        }

        counts.set(element.level, (counts.get(element.level) ?? 0) + 1);
    }

    let busiest: string | null = null;
    let most = 0;

    // Ties go to the lowest level, so the ground floor wins by default.
    for (const level of document.levels) {
        const count = counts.get(level.id) ?? 0;

        if (count > most) {
            busiest = level.id;
            most = count;
        }
    }

    return busiest;
}

function polygonArea(points: { x: number; y: number }[]): number {
    if (points.length < 3) {
        return 0;
    }

    let doubled = 0;

    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];

        doubled += current.x * next.y - next.x * current.y;
    }

    return Math.abs(doubled) / 2;
}
