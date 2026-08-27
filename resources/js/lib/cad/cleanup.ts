/**
 * Clean Up Model: the command that fixes what Review Warnings reports.
 *
 * Everything here is a small, describable repair a careful drafter would
 * make by hand — close a corner that misses by a centimetre, square a wall
 * that is a hair off axis, delete the sliver a stray click left behind.
 * Nothing creative, nothing destructive to intent: a wall drawn at 30° is a
 * design decision and is left alone; a wall 0.2° off square is a slip.
 *
 * Pinned elements are never touched — cleanup is a transform path like any
 * other, and the pin means what it always means.
 */

import { distance } from '@/lib/cad/geometry';
import {
    clampOpeningParameter,
    maxOpeningWidth,
    openingSize,
} from '@/lib/cad/model';
import type {
    CadDocument,
    CadElement,
    MeshElement,
    OpeningElement,
    Point,
    WallElement,
} from '@/lib/cad/types';

/**
 * How far apart two wall ends may sit and still be one corner. Revit closes
 * joins about this eagerly; anything larger is treated as drawn on purpose.
 */
export const WELD_TOLERANCE = 25;

/**
 * A wall is squared to the axis only when doing so moves each end less than
 * this — a slip is measured in millimetres, an angle in metres is a design.
 */
const SQUARE_TOLERANCE = 25;

/** Below this a wall is a dot pretending — the same line checkup draws. */
const SLIVER_LENGTH = 10;

/** Duplicate walls match their ends within this after welding. */
const DUPLICATE_TOLERANCE = 1;

/** A mesh triangle thinner than this is a rendering artefact, not a face. */
const DEGENERATE_AREA = 0.5;

export type CleanupReport = {
    document: CadDocument;
    /** One line per kind of repair made, worded for the status bar. */
    fixes: string[];
    /** Total individual repairs, zero when the model was already clean. */
    changed: number;
};

/**
 * Repair the model. Safe to run twice — a clean model comes back untouched.
 *
 * The steps feed each other — squaring a wall can open a corner welding then
 * closes — so the pipeline runs to a fixpoint internally. The report counts
 * the problems the first pass found; the quiet extra passes are settling,
 * not new faults.
 */
export function cleanUpDocument(document: CadDocument): CleanupReport {
    const first = cleanOnce(document);
    let current = first.document;

    for (let pass = 0; pass < 8 && first.changed > 0; pass++) {
        const again = cleanOnce(current);
        current = again.document;

        if (again.changed === 0) {
            break;
        }
    }

    return { document: current, fixes: first.fixes, changed: first.changed };
}

function cleanOnce(document: CadDocument): CleanupReport {
    const fixes: string[] = [];
    let changed = 0;

    const note = (count: number, line: string): void => {
        if (count > 0) {
            fixes.push(line);
            changed += count;
        }
    };

    let current = document;

    const squared = squareAlmostStraightWalls(current);
    current = squared.document;
    note(
        squared.count,
        `Squared ${squared.count} nearly-straight wall${squared.count === 1 ? '' : 's'}`,
    );

    const welded = weldWallCorners(current);
    current = welded.document;
    note(
        welded.count,
        `Closed ${welded.count} open corner${welded.count === 1 ? '' : 's'}`,
    );

    const slivers = removeSliverWalls(current);
    current = slivers.document;
    note(
        slivers.count,
        `Removed ${slivers.count} sliver wall${slivers.count === 1 ? '' : 's'}`,
    );

    const duplicates = mergeDuplicateWalls(current);
    current = duplicates.document;
    note(
        duplicates.count,
        `Merged ${duplicates.count} duplicate wall${duplicates.count === 1 ? '' : 's'}`,
    );

    const fitted = fitOpenings(current);
    current = fitted.document;
    note(
        fitted.count,
        `Fitted ${fitted.count} opening${fitted.count === 1 ? '' : 's'} back inside their walls`,
    );

    const orphans = removeOrphanedOpenings(current);
    current = orphans.document;
    note(
        orphans.count,
        `Removed ${orphans.count} orphaned opening${orphans.count === 1 ? '' : 's'}`,
    );

    const meshes = polishMeshes(current);
    current = meshes.document;
    note(
        meshes.count,
        `Dropped ${meshes.count} broken triangle${meshes.count === 1 ? '' : 's'} from imported models`,
    );

    return { document: current, fixes, changed };
}

type Step = { document: CadDocument; count: number };

function walls(document: CadDocument): WallElement[] {
    return document.elements.filter(
        (element): element is WallElement => element.kind === 'wall',
    );
}

/* -------------------------------------------------------------- squaring */

/**
 * A wall meant to be straight but drawn a few millimetres off is pulled onto
 * the axis, both ends meeting in the middle so neither corner moves far.
 */
function squareAlmostStraightWalls(document: CadDocument): Step {
    let count = 0;

    const elements = document.elements.map((element): CadElement => {
        if (element.kind !== 'wall' || element.pinned) {
            return element;
        }

        const dx = Math.abs(element.b.x - element.a.x);
        const dy = Math.abs(element.b.y - element.a.y);

        // Nearly horizontal: the y slip is small and clearly the minor axis.
        // Slips under half a millimetre are float dust, not drafting.
        if (dy > 0.5 && dy <= SQUARE_TOLERANCE && dx > dy * 4) {
            const y = (element.a.y + element.b.y) / 2;

            count += 1;

            return {
                ...element,
                a: { ...element.a, y },
                b: { ...element.b, y },
            };
        }

        if (dx > 0.5 && dx <= SQUARE_TOLERANCE && dy > dx * 4) {
            const x = (element.a.x + element.b.x) / 2;

            count += 1;

            return {
                ...element,
                a: { ...element.a, x },
                b: { ...element.b, x },
            };
        }

        return element;
    });

    return { document: { ...document, elements }, count };
}

/* --------------------------------------------------------------- welding */

type WallEnd = {
    wallId: string;
    end: 'a' | 'b';
    point: Point;
    pinned: boolean;
    /** Whether the wall this end belongs to runs dead level or dead plumb. */
    horizontal: boolean;
    vertical: boolean;
};

/**
 * Wall ends that almost meet are snapped to one point, so the corner joins
 * and the poché mitres. A pinned wall anchors its cluster: everyone else
 * comes to it.
 */
function weldWallCorners(document: CadDocument): Step {
    const byLevel = new Map<string, WallEnd[]>();

    for (const wall of walls(document)) {
        const ends = byLevel.get(wall.level) ?? [];
        const horizontal = wall.a.y === wall.b.y;
        const vertical = wall.a.x === wall.b.x;

        ends.push(
            {
                wallId: wall.id,
                end: 'a',
                point: wall.a,
                pinned: wall.pinned === true,
                horizontal,
                vertical,
            },
            {
                wallId: wall.id,
                end: 'b',
                point: wall.b,
                pinned: wall.pinned === true,
                horizontal,
                vertical,
            },
        );
        byLevel.set(wall.level, ends);
    }

    const moves = new Map<string, Point>();
    let count = 0;

    for (const ends of byLevel.values()) {
        const claimed = new Set<number>();

        for (let index = 0; index < ends.length; index++) {
            if (claimed.has(index)) {
                continue;
            }

            const cluster = [index];

            for (let other = index + 1; other < ends.length; other++) {
                if (claimed.has(other)) {
                    continue;
                }

                const near = cluster.some(
                    (member) =>
                        distance(ends[member].point, ends[other].point) <=
                        WELD_TOLERANCE,
                );

                if (near) {
                    cluster.push(other);
                }
            }

            if (cluster.length < 2) {
                continue;
            }

            cluster.forEach((member) => claimed.add(member));

            const members = cluster.map((member) => ends[member]);
            const anchor = members.find((member) => member.pinned);

            // The corner belongs where the straight walls say it does: a
            // plumb wall keeps its x, a level wall keeps its y. Only what
            // neither claims falls back to the centroid — this is also what
            // keeps a squared wall square when its corner is re-welded.
            const plumb = members.find((member) => member.vertical);
            const level = members.find((member) => member.horizontal);
            const target = anchor
                ? anchor.point
                : {
                      x:
                          plumb?.point.x ??
                          members.reduce((sum, m) => sum + m.point.x, 0) /
                              members.length,
                      y:
                          level?.point.y ??
                          members.reduce((sum, m) => sum + m.point.y, 0) /
                              members.length,
                  };

            let welded = false;

            for (const member of members) {
                if (member.pinned) {
                    continue;
                }

                if (distance(member.point, target) > 0.001) {
                    moves.set(`${member.wallId}:${member.end}`, target);
                    welded = true;
                }
            }

            if (welded) {
                count += 1;
            }
        }
    }

    if (moves.size === 0) {
        return { document, count: 0 };
    }

    const elements = document.elements.map((element): CadElement => {
        if (element.kind !== 'wall') {
            return element;
        }

        const a = moves.get(`${element.id}:a`);
        const b = moves.get(`${element.id}:b`);

        if (!a && !b) {
            return element;
        }

        return { ...element, a: a ?? element.a, b: b ?? element.b };
    });

    return { document: { ...document, elements }, count };
}

/* ---------------------------------------------------------------- slivers */

/**
 * A wall too short to be a wall goes, and takes anything hosted on it along
 * — nothing can sensibly hang on a ten-millimetre stub.
 */
function removeSliverWalls(document: CadDocument): Step {
    const doomed = new Set(
        walls(document)
            .filter(
                (wall) =>
                    !wall.pinned && distance(wall.a, wall.b) < SLIVER_LENGTH,
            )
            .map((wall) => wall.id),
    );

    if (doomed.size === 0) {
        return { document, count: 0 };
    }

    const elements = document.elements.filter((element) => {
        if (doomed.has(element.id)) {
            return false;
        }

        return !(
            (element.kind === 'door' || element.kind === 'window') &&
            doomed.has(element.host) &&
            !element.pinned
        );
    });

    return { document: { ...document, elements }, count: doomed.size };
}

/* ------------------------------------------------------------- duplicates */

/**
 * Two walls of the same type lying end to end on the same points are one
 * wall drawn twice. The survivor inherits the duplicate's openings, with the
 * position parameter flipped when the duplicate ran the other way.
 */
function mergeDuplicateWalls(document: CadDocument): Step {
    const seen: WallElement[] = [];
    const doomed = new Map<string, { keep: string; reversed: boolean }>();

    for (const wall of walls(document)) {
        const match = seen.find(
            (kept) =>
                kept.level === wall.level &&
                kept.typeId === wall.typeId &&
                (sameEnds(kept.a, kept.b, wall.a, wall.b) ||
                    sameEnds(kept.a, kept.b, wall.b, wall.a)),
        );

        if (!match) {
            seen.push(wall);
            continue;
        }

        // Keep the pinned one when the pins disagree.
        if (wall.pinned && !match.pinned) {
            doomed.set(match.id, {
                keep: wall.id,
                reversed: !sameEnds(match.a, match.b, wall.a, wall.b),
            });
            seen[seen.indexOf(match)] = wall;
        } else if (!wall.pinned) {
            doomed.set(wall.id, {
                keep: match.id,
                reversed: !sameEnds(match.a, match.b, wall.a, wall.b),
            });
        }
    }

    if (doomed.size === 0) {
        return { document, count: 0 };
    }

    const elements = document.elements
        .filter((element) => !doomed.has(element.id))
        .map((element): CadElement => {
            if (element.kind !== 'door' && element.kind !== 'window') {
                return element;
            }

            const rehome = doomed.get(element.host);

            if (!rehome) {
                return element;
            }

            return {
                ...element,
                host: rehome.keep,
                t: rehome.reversed ? 1 - element.t : element.t,
            };
        });

    return { document: { ...document, elements }, count: doomed.size };
}

function sameEnds(a1: Point, b1: Point, a2: Point, b2: Point): boolean {
    return (
        distance(a1, a2) <= DUPLICATE_TOLERANCE &&
        distance(b1, b2) <= DUPLICATE_TOLERANCE
    );
}

/* --------------------------------------------------------------- openings */

/**
 * An opening its wall can no longer carry — usually because the wall was
 * shortened after the window was widened — is shrunk to what fits and slid
 * back between the jamb margins.
 */
function fitOpenings(document: CadDocument): Step {
    const byId = new Map(walls(document).map((wall) => [wall.id, wall]));
    let count = 0;

    const elements = document.elements.map((element): CadElement => {
        if (
            (element.kind !== 'door' && element.kind !== 'window') ||
            element.pinned
        ) {
            return element;
        }

        const host = byId.get(element.host);

        if (!host) {
            return element;
        }

        const length = distance(host.a, host.b);
        const room = maxOpeningWidth(length);
        const { width } = openingSize(document, element);

        const fittedWidth = Math.min(width, room);
        const fittedT = clampOpeningParameter(fittedWidth, length, element.t);

        if (fittedWidth === width && fittedT === element.t) {
            return element;
        }

        count += 1;

        return {
            ...element,
            t: fittedT,
            ...(fittedWidth === width ? {} : { width: fittedWidth }),
        } as OpeningElement;
    });

    return { document: { ...document, elements }, count };
}

/**
 * A door or window whose wall has gone renders nothing sensible; it goes.
 */
function removeOrphanedOpenings(document: CadDocument): Step {
    const hosts = new Set(walls(document).map((wall) => wall.id));
    let count = 0;

    const elements = document.elements.filter((element) => {
        const orphaned =
            (element.kind === 'door' || element.kind === 'window') &&
            !hosts.has(element.host) &&
            !element.pinned;

        if (orphaned) {
            count += 1;
        }

        return !orphaned;
    });

    return { document: { ...document, elements }, count };
}

/* ----------------------------------------------------------------- meshes */

/**
 * Imported scans arrive with rough edges of their own: zero-area triangles
 * and broken numbers that render as flicker and export as junk. Drop them;
 * the shape does not miss what has no area.
 */
function polishMeshes(document: CadDocument): Step {
    let count = 0;

    const elements = document.elements.map((element): CadElement => {
        if (element.kind !== 'mesh' || element.pinned) {
            return element;
        }

        const kept: number[] = [];
        let dropped = 0;

        for (let index = 0; index + 8 < element.vertices.length; index += 9) {
            const triangle = element.vertices.slice(index, index + 9);

            if (
                triangle.some((value) => !Number.isFinite(value)) ||
                triangleArea(triangle) < DEGENERATE_AREA
            ) {
                dropped += 1;
                continue;
            }

            kept.push(...triangle);
        }

        if (dropped === 0) {
            return element;
        }

        count += dropped;

        return { ...element, vertices: kept } as MeshElement;
    });

    return { document: { ...document, elements }, count };
}

function triangleArea(triangle: number[]): number {
    const ux = triangle[3] - triangle[0];
    const uy = triangle[4] - triangle[1];
    const uz = triangle[5] - triangle[2];
    const vx = triangle[6] - triangle[0];
    const vy = triangle[7] - triangle[1];
    const vz = triangle[8] - triangle[2];

    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;

    return Math.hypot(cx, cy, cz) / 2;
}
