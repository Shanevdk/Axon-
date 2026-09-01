import { describe, expect, it } from 'vitest';

import {
    contourInterval,
    contourLines,
    coversPoint,
    flatTerrain,
    groundUnder,
    heightAt,
    heightRange,
    levelTerrainTo,
    moveTerrain,
    terrainBounds,
} from './terrain';
import type { Terrain } from './types';

/**
 * Ground falling evenly to the west: 500mm of rise for every metre east, so
 * the height at any point is simply its x halved.
 */
function slope(columns = 5, rows = 5, spacing = 1000, rise = 500): Terrain {
    const heights: number[] = [];

    for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < columns; c += 1) {
            heights.push(c * rise);
        }
    }

    return { originX: 0, originY: 0, spacing, columns, rows, heights };
}

describe('the shape of the grid', () => {
    it('covers the span it was asked for', () => {
        const terrain = flatTerrain(40_000, 5000);

        expect(terrain.columns).toBe(9);
        expect(terrain.rows).toBe(9);
        expect(terrain.heights).toHaveLength(81);
        expect(terrainBounds(terrain)).toEqual({
            minX: -20_000,
            minY: -20_000,
            maxX: 20_000,
            maxY: 20_000,
        });
    });

    it('knows what it has surveyed and what it has not', () => {
        const terrain = flatTerrain(40_000, 5000);

        expect(coversPoint(terrain, { x: 0, y: 0 })).toBe(true);
        expect(coversPoint(terrain, { x: 20_000, y: 20_000 })).toBe(true);
        expect(coversPoint(terrain, { x: 20_001, y: 0 })).toBe(false);
    });
});

describe('height at a point', () => {
    it('returns the sample itself where one was taken', () => {
        const terrain = slope();

        expect(heightAt(terrain, { x: 0, y: 0 })).toBe(0);
        expect(heightAt(terrain, { x: 2000, y: 0 })).toBe(1000);
        expect(heightAt(terrain, { x: 4000, y: 3000 })).toBe(2000);
    });

    it('interpolates between samples rather than stepping', () => {
        const terrain = slope();

        // Half a cell east is half a cell's worth of rise, not the next one.
        expect(heightAt(terrain, { x: 500, y: 0 })).toBe(250);
        expect(heightAt(terrain, { x: 2500, y: 1500 })).toBe(1250);
    });

    it('interpolates in both directions at once', () => {
        const terrain: Terrain = {
            originX: 0,
            originY: 0,
            spacing: 1000,
            columns: 2,
            rows: 2,
            heights: [0, 1000, 1000, 2000],
        };

        expect(heightAt(terrain, { x: 500, y: 500 })).toBe(1000);
        expect(heightAt(terrain, { x: 250, y: 750 })).toBe(1000);
    });

    it('carries the edge outwards instead of falling off a cliff', () => {
        // An elevation should not show the ground dropping to zero where the
        // survey happened to stop.
        const terrain = slope();

        expect(heightAt(terrain, { x: 40_000, y: 0 })).toBe(2000);
        expect(heightAt(terrain, { x: -9000, y: -9000 })).toBe(0);
    });

    it('reports the range of the whole survey', () => {
        expect(heightRange(slope())).toEqual({ min: 0, max: 2000 });
        expect(heightRange(flatTerrain(10_000, 5000, 700))).toEqual({
            min: 700,
            max: 700,
        });
    });
});

describe('the ground under a footprint', () => {
    it('measures the fall a house would have to step', () => {
        const terrain = slope();

        const under = groundUnder(terrain, [
            { x: 1000, y: 1000 },
            { x: 3000, y: 1000 },
            { x: 3000, y: 3000 },
            { x: 1000, y: 3000 },
        ]);

        expect(under.min).toBe(500);
        expect(under.max).toBe(1500);
        expect(under.fall).toBe(1000);
        expect(under.average).toBe(1000);
    });

    it('says nothing rather than guessing when there is no footprint', () => {
        expect(groundUnder(slope(), []).fall).toBe(0);
    });
});

describe('choosing a contour interval', () => {
    it('picks a round number a surveyor would recognise', () => {
        const rounds = [100, 200, 250, 500, 1000, 2000, 2500, 5000];

        [400, 3000, 12_000, 40_000].forEach((fall) => {
            expect(rounds).toContain(contourInterval({ min: 0, max: fall }));
        });
    });

    it('keeps the sheet readable however steep the site', () => {
        [500, 3000, 12_000, 40_000, 120_000].forEach((fall) => {
            const lines = fall / contourInterval({ min: 0, max: fall });

            expect(lines).toBeGreaterThanOrEqual(4);
            expect(lines).toBeLessThanOrEqual(12);
        });
    });
});

describe('contour lines', () => {
    it('draws even ground as straight lines at the right heights', () => {
        // On ground that rises 500mm per metre, the 1000mm contour must run
        // dead north-south through x = 2000.
        const lines = contourLines(slope(), 500);

        expect(lines.map((line) => line.height)).toEqual([500, 1000, 1500, 2000]);

        const thousand = lines.find((line) => line.height === 1000);

        expect(thousand?.segments).toHaveLength(4);

        thousand?.segments.forEach(([from, to]) => {
            expect(from.x).toBeCloseTo(2000);
            expect(to.x).toBeCloseTo(2000);
        });
    });

    it('draws nothing on ground that does not move', () => {
        expect(contourLines(flatTerrain(20_000, 5000, 1200))).toEqual([]);
    });

    it('chooses its own interval when not told one', () => {
        const lines = contourLines(slope());

        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((line) => line.segments.length > 0)).toBe(true);
    });

    it('resolves a saddle into two separate strokes', () => {
        // Two high corners diagonally opposite: the contour could be drawn
        // either way round, and the wrong choice makes crossing lines.
        const saddle: Terrain = {
            originX: 0,
            originY: 0,
            spacing: 1000,
            columns: 2,
            rows: 2,
            heights: [1000, 0, 0, 1000],
        };

        const halfway = contourLines(saddle, 500).find(
            (line) => line.height === 500,
        );

        // Two strokes, one around each low corner — never one long stroke
        // through the middle, and never four crossing each other.
        expect(halfway?.segments).toHaveLength(2);
    });

    it('never strays outside the ground it was measured from', () => {
        const terrain = slope();
        const bounds = terrainBounds(terrain);

        contourLines(terrain, 250).forEach((line) => {
            line.segments.flat().forEach((point) => {
                expect(point.x).toBeGreaterThanOrEqual(bounds.minX);
                expect(point.x).toBeLessThanOrEqual(bounds.maxX);
                expect(point.y).toBeGreaterThanOrEqual(bounds.minY);
                expect(point.y).toBeLessThanOrEqual(bounds.maxY);
            });
        });
    });
});

describe('siting the building', () => {
    it('slides the ground the other way, so the model stays put', () => {
        // Dragging the house 2m east must show the ground that was 2m east
        // of the origin arriving under it.
        const terrain = slope();
        const moved = moveTerrain(terrain, 2000, 0);

        expect(heightAt(moved, { x: 0, y: 0 })).toBe(
            heightAt(terrain, { x: 2000, y: 0 }),
        );
    });

    it('leaves the heights themselves alone when moving', () => {
        const terrain = slope();

        expect(moveTerrain(terrain, 500, -300).heights).toEqual(terrain.heights);
    });

    it('drops the whole survey to put a point at a chosen level', () => {
        const terrain = levelTerrainTo(slope(), { x: 2000, y: 0 }, 0);

        expect(heightAt(terrain, { x: 2000, y: 0 })).toBe(0);
        // The shape is unchanged; only the datum moved.
        expect(heightAt(terrain, { x: 4000, y: 0 })).toBe(1000);
        expect(heightAt(terrain, { x: 0, y: 0 })).toBe(-1000);
    });
});
