import { describe, expect, it } from 'vitest';
import {
    formatPlace,
    panBy,
    pointAt,
    project,
    roundPlace,
    TILE_SIZE,
    tileGrid,
    tileUrl,
    unproject,
} from '@/lib/map';

const VANCOUVER = { latitude: 49.2827, longitude: -123.1207 };

describe('project', () => {
    it('puts the null island at the middle of the world', () => {
        const point = project({ latitude: 0, longitude: 0 }, 0);

        expect(point.x).toBeCloseTo(TILE_SIZE / 2);
        expect(point.y).toBeCloseTo(TILE_SIZE / 2);
    });

    it('doubles the world with every zoom level', () => {
        const near = project(VANCOUVER, 4);
        const far = project(VANCOUVER, 5);

        expect(far.x).toBeCloseTo(near.x * 2);
        expect(far.y).toBeCloseTo(near.y * 2);
    });

    it('puts the northern hemisphere in the top half', () => {
        expect(project(VANCOUVER, 8).y).toBeLessThan(
            (TILE_SIZE * 2 ** 8) / 2,
        );
    });

    it('comes back to where it started', () => {
        const point = project(VANCOUVER, 16);
        const back = unproject(point.x, point.y, 16);

        expect(back.latitude).toBeCloseTo(VANCOUVER.latitude, 6);
        expect(back.longitude).toBeCloseTo(VANCOUVER.longitude, 6);
    });

    it('does not run away at the pole', () => {
        const point = project({ latitude: 90, longitude: 0 }, 4);

        expect(Number.isFinite(point.y)).toBe(true);
        expect(point.y).toBeCloseTo(0, 5);
    });
});

describe('panning', () => {
    it('moves the map the way the hand goes', () => {
        // Dragging the map to the right pulls the view west.
        const panned = panBy(VANCOUVER, 14, 100, 0);

        expect(panned.longitude).toBeLessThan(VANCOUVER.longitude);
        expect(panned.latitude).toBeCloseTo(VANCOUVER.latitude, 6);
    });

    it('moves further per pixel the further out you are', () => {
        const close = panBy(VANCOUVER, 18, 100, 0);
        const wide = panBy(VANCOUVER, 10, 100, 0);

        expect(Math.abs(wide.longitude - VANCOUVER.longitude)).toBeGreaterThan(
            Math.abs(close.longitude - VANCOUVER.longitude),
        );
    });

    it('leaves the centre alone when nothing moved', () => {
        const panned = panBy(VANCOUVER, 14, 0, 0);

        expect(panned.latitude).toBeCloseTo(VANCOUVER.latitude, 9);
        expect(panned.longitude).toBeCloseTo(VANCOUVER.longitude, 9);
    });
});

describe('pointAt', () => {
    it('reads the centre of the viewport as the centre of the map', () => {
        const place = pointAt(VANCOUVER, 15, 0, 0);

        expect(place.latitude).toBeCloseTo(VANCOUVER.latitude, 9);
        expect(place.longitude).toBeCloseTo(VANCOUVER.longitude, 9);
    });

    it('reads a click above and right as north and east', () => {
        const place = pointAt(VANCOUVER, 15, 60, -60);

        expect(place.longitude).toBeGreaterThan(VANCOUVER.longitude);
        expect(place.latitude).toBeGreaterThan(VANCOUVER.latitude);
    });
});

describe('tileGrid', () => {
    it('covers the whole viewport', () => {
        const tiles = tileGrid(VANCOUVER, 14, 600, 400);

        expect(tiles.length).toBeGreaterThan(0);

        const left = Math.min(...tiles.map((tile) => tile.left));
        const top = Math.min(...tiles.map((tile) => tile.top));
        const right = Math.max(
            ...tiles.map((tile) => tile.left + TILE_SIZE),
        );
        const bottom = Math.max(...tiles.map((tile) => tile.top + TILE_SIZE));

        expect(left).toBeLessThanOrEqual(0);
        expect(top).toBeLessThanOrEqual(0);
        expect(right).toBeGreaterThanOrEqual(600);
        expect(bottom).toBeGreaterThanOrEqual(400);
    });

    it('asks for no more tiles than it needs', () => {
        // 600 × 400 is three columns of two rows, four at the worst offset.
        expect(tileGrid(VANCOUVER, 14, 600, 400).length).toBeLessThanOrEqual(
            4 * 3,
        );
    });

    it('wraps around the date line rather than leaving a gap', () => {
        const tiles = tileGrid(
            { latitude: 0, longitude: 179.99 },
            4,
            600,
            400,
        );

        const span = 2 ** 4;

        expect(tiles.every((tile) => tile.x >= 0 && tile.x < span)).toBe(true);
        // The wrap means the same row holds both the last column and the first.
        expect(tiles.some((tile) => tile.x === 0)).toBe(true);
        expect(tiles.some((tile) => tile.x === span - 1)).toBe(true);
    });

    it('does not ask for tiles off the top of the world', () => {
        const tiles = tileGrid({ latitude: 85, longitude: 0 }, 3, 600, 400);

        expect(tiles.every((tile) => tile.y >= 0 && tile.y < 2 ** 3)).toBe(
            true,
        );
    });

    it('keys a tile by where it is, so a pan reuses the image', () => {
        const before = tileGrid(VANCOUVER, 14, 600, 400);
        const after = tileGrid(panBy(VANCOUVER, 14, 20, 0), 14, 600, 400);

        const shared = before.filter((tile) =>
            after.some((other) => other.key === tile.key),
        );

        expect(shared.length).toBeGreaterThan(0);
    });
});

describe('tileUrl', () => {
    it('fills the template', () => {
        expect(
            tileUrl('https://tile.example/{z}/{x}/{y}.png', {
                x: 5,
                y: 9,
                z: 14,
                left: 0,
                top: 0,
                key: '',
            }),
        ).toBe('https://tile.example/14/5/9.png');
    });
});

describe('writing a place down', () => {
    it('rounds to a tenth of a metre', () => {
        expect(roundPlace({ latitude: 49.28271234, longitude: -123.12079876 }))
            .toEqual({ latitude: 49.282712, longitude: -123.120799 });
    });

    it('reads as a compass bearing rather than a signed number', () => {
        expect(formatPlace(VANCOUVER)).toBe('49.28270° N, 123.12070° W');
    });
});
