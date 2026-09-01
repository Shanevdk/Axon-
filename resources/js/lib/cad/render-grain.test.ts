import { describe, expect, it } from 'vitest';
import type { Face } from '@/lib/cad/mesh';
import { draw3d } from '@/lib/cad/render-3d';
import type { OrbitCamera } from '@/lib/cad/types';

/**
 * Enough of a 2D context to record what was drawn.
 *
 * The grain is the only thing here that strokes a path it did not first fill,
 * so the segments recorded between the last fill and the stroke are it.
 */
function recorder() {
    const segments: { from: Point; to: Point }[] = [];
    let cursor: Point = { x: 0, y: 0 };
    let clipping = false;

    const ctx = {
        canvas: {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
        lineJoin: '',
        globalAlpha: 1,
        save: () => {},
        restore: () => {
            clipping = false;
        },
        beginPath: () => {},
        closePath: () => {},
        // A clip is the grain routine fencing itself to the face; everything
        // moved and lined after one, until the restore, is a mark.
        clip: () => {
            clipping = true;
        },
        moveTo: (x: number, y: number) => {
            cursor = { x, y };
        },
        lineTo: (x: number, y: number) => {
            if (clipping) {
                segments.push({ from: cursor, to: { x, y } });
            }

            cursor = { x, y };
        },
        fill: () => {},
        stroke: () => {},
        fillRect: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        setTransform: () => {},
    } as unknown as CanvasRenderingContext2D;

    return { ctx, segments };
}

type Point = { x: number; y: number };

/** A timber wall 6 m long and 3 m high, standing on the ground facing south. */
const WALL: Face = {
    vertices: [
        { x: -3000, y: 0, z: 0 },
        { x: 3000, y: 0, z: 0 },
        { x: 3000, y: 0, z: 3000 },
        { x: -3000, y: 0, z: 3000 },
    ],
    color: '#c08e4e',
    elementId: 'w1',
    layer: 2,
    order: 0,
    material: 'wood',
};

const VIEWPORT = { width: 1200, height: 800 };

function look(azimuth: number): OrbitCamera {
    return {
        azimuth,
        elevation: 0.25,
        distance: 12_000,
        target: { x: 0, y: 0, z: 1500 },
    };
}

function render(camera: OrbitCamera) {
    const { ctx, segments } = recorder();

    draw3d(
        ctx,
        {
            faces: [WALL],
            camera,
            projection: 'perspective',
            visualStyle: 'shaded',
            selection: new Set<string>(),
            hovered: null,
            naturalMaterials: true,
        },
        VIEWPORT,
    );

    return segments;
}

describe('grain on a wall, as the model turns', () => {
    it('is actually drawn', () => {
        // Guards the obvious way to make grain stop swimming: stop drawing it.
        expect(render(look(-Math.PI / 2)).length).toBeGreaterThan(3);
    });

    it('slants with the wall when the wall is seen at an angle', () => {
        // Level lines on a wall seen obliquely project to slanted ones. The
        // old screen-space grain was laid over the projected outline and so
        // came out flat on screen whatever the camera was doing — this is
        // what tells the two apart.
        const oblique = render(look(-Math.PI / 2 + 0.6));

        expect(oblique.length).toBeGreaterThan(3);

        const slanted = oblique.filter(
            (segment) => Math.abs(segment.to.y - segment.from.y) > 1,
        );

        expect(slanted.length).toBeGreaterThan(0);
    });

    it('keeps the same number of marks whichever way the model is turned', () => {
        // The marks belong to the wall, so turning the camera cannot add or
        // remove any. Screen-space grain re-counted itself on every frame.
        const straight = render(look(-Math.PI / 2)).length;

        [0.3, 0.6, 0.9].forEach((turn) => {
            expect(render(look(-Math.PI / 2 + turn)).length).toBe(straight);
        });
    });

    it('leaves the surface plain from far enough away to smudge', () => {
        // Real spacing means standing back closes the marks up. Better a
        // clean wall than a grey smear.
        const close = render(look(-Math.PI / 2));
        const far = render({ ...look(-Math.PI / 2), distance: 400_000 });

        expect(close.length).toBeGreaterThan(0);
        expect(far).toHaveLength(0);
    });
});
