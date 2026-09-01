import { describe, expect, it } from 'vitest';

import { testDocument } from './__fixtures__/document';
import { groundFaces } from './mesh';
import { flatTerrain } from './terrain';
import type { CadDocument, Site, Terrain } from './types';

/** Ground rising 500mm for every metre east, measured over 40m. */
function slopingSite(): Site {
    const columns = 5;
    const rows = 5;
    const heights: number[] = [];

    for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < columns; c += 1) {
            heights.push(c * 500);
        }
    }

    const terrain: Terrain = {
        originX: -20_000,
        originY: -20_000,
        spacing: 10_000,
        columns,
        rows,
        heights,
    };

    return { latitude: 49.2, longitude: -122.9, seaLevel: 80, terrain };
}

function withSite(site: Site | null): CadDocument {
    return testDocument({ site });
}

describe('ground under the model', () => {
    it('is one flat plate when nothing has been surveyed', () => {
        const faces = groundFaces(testDocument());

        expect(faces).toHaveLength(1);
        expect(new Set(faces[0].vertices.map((vertex) => vertex.z)).size).toBe(1);
    });

    it('is still a flat plate when a site has no terrain yet', () => {
        const faces = groundFaces(
            withSite({
                latitude: 49.2,
                longitude: -122.9,
                seaLevel: 80,
                terrain: null,
            }),
        );

        expect(faces).toHaveLength(1);
    });

    it('sits below the lowest level so the building rests on it', () => {
        const faces = groundFaces(testDocument());

        faces[0].vertices.forEach((vertex) => {
            expect(vertex.z).toBeLessThan(0);
        });
    });

    it('becomes a real surface once the ground has been measured', () => {
        const faces = groundFaces(withSite(slopingSite()));

        expect(faces.length).toBeGreaterThan(1);

        const heights = faces.flatMap((face) =>
            face.vertices.map((vertex) => vertex.z),
        );

        // The survey rises 2m across itself, and the mesh must carry that.
        expect(Math.max(...heights) - Math.min(...heights)).toBeCloseTo(2000);
    });

    it('follows the survey rather than averaging it flat', () => {
        const faces = groundFaces(withSite(slopingSite()));

        const west = faces.flatMap((face) =>
            face.vertices.filter((vertex) => vertex.x < -19_000),
        );
        const east = faces.flatMap((face) =>
            face.vertices.filter((vertex) => vertex.x > 19_000),
        );

        expect(Math.max(...west.map((vertex) => vertex.z))).toBeCloseTo(0);
        expect(Math.min(...east.map((vertex) => vertex.z))).toBeCloseTo(2000);
    });

    it('reaches well past the survey so the model is never on an island', () => {
        const faces = groundFaces(withSite(slopingSite()));
        const xs = faces.flatMap((face) => face.vertices.map((v) => v.x));

        // The survey is only 40m across; the ground has to run further out
        // than that or an elevation shows the world ending beside the house.
        expect(Math.min(...xs)).toBeLessThanOrEqual(-60_000);
        expect(Math.max(...xs)).toBeGreaterThanOrEqual(60_000);
    });

    it('draws level ground level, however finely it was sampled', () => {
        const site: Site = {
            latitude: 49.2,
            longitude: -122.9,
            seaLevel: 80,
            terrain: flatTerrain(40_000, 10_000, 1500),
        };

        const heights = groundFaces(withSite(site)).flatMap((face) =>
            face.vertices.map((vertex) => vertex.z),
        );

        expect(new Set(heights)).toEqual(new Set([1500]));
    });

    it('keeps every ground face in the ground bucket, under the building', () => {
        groundFaces(withSite(slopingSite())).forEach((face) => {
            expect(face.layer).toBe(0);
            expect(face.material).toBe('earth');
            expect(face.elementId).toBe('');
        });
    });
});
