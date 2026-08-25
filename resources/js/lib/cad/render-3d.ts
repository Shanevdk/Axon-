import { pointInPolygon } from '@/lib/cad/geometry';
import type { Face, Vertex } from '@/lib/cad/mesh';
import { AMBIENT_LIGHT, CAD_THEME, LIGHT_DIRECTION } from '@/lib/cad/theme';
import type { OrbitCamera, Point, VisualStyle } from '@/lib/cad/types';

const NEAR_PLANE = 60;
const FIELD_OF_VIEW = Math.PI / 4;

export type Projection = 'perspective' | 'orthographic';

export type Scene3D = {
    faces: Face[];
    camera: OrbitCamera;
    projection: Projection;
    visualStyle: VisualStyle;
    selection: Set<string>;
    hovered: string | null;
};

export type PickTarget = {
    elementId: string;
    polygon: Point[];
    depth: number;
};

type Basis = {
    eye: Vertex;
    right: Vertex;
    up: Vertex;
    forward: Vertex;
};

export function cameraBasis(camera: OrbitCamera): Basis {
    const cosElevation = Math.cos(camera.elevation);
    const offset: Vertex = {
        x: cosElevation * Math.cos(camera.azimuth),
        y: cosElevation * Math.sin(camera.azimuth),
        z: Math.sin(camera.elevation),
    };

    const eye: Vertex = {
        x: camera.target.x + offset.x * camera.distance,
        y: camera.target.y + offset.y * camera.distance,
        z: camera.target.z + offset.z * camera.distance,
    };

    const forward = normalize3({ x: -offset.x, y: -offset.y, z: -offset.z });
    const worldUp: Vertex = { x: 0, y: 0, z: 1 };
    const right = normalize3(cross3(forward, worldUp));
    const up = cross3(right, forward);

    return { eye, right, up, forward };
}

/**
 * Render the model with a painter's algorithm.
 *
 * Slabs are drawn from the ground up before anything else so a large floor
 * never sorts in front of the walls standing on it; the remaining faces are
 * ordered back to front by their distance from the camera.
 */
export function draw3d(
    ctx: CanvasRenderingContext2D,
    scene: Scene3D,
    viewport: { width: number; height: number },
): PickTarget[] {
    const { width, height } = viewport;
    const basis = cameraBasis(scene.camera);
    const focal = height / 2 / Math.tan(FIELD_OF_VIEW / 2);
    const orthoScale =
        (height * 0.5) / Math.max(scene.camera.distance * 0.55, 1);
    const hiddenLine = scene.visualStyle === 'hiddenLine';
    const wireframe = scene.visualStyle === 'wireframe';

    paintBackground(ctx, viewport, hiddenLine || wireframe);

    type Prepared = {
        face: Face;
        polygon: Point[];
        depth: number;
        intensity: number;
    };

    const prepared: Prepared[] = [];

    scene.faces.forEach((face) => {
        const cameraSpace = face.vertices.map((vertex) =>
            toCameraSpace(vertex, basis),
        );
        const clipped = clipNear(cameraSpace);

        if (clipped.length < 3) {
            return;
        }

        const polygon = clipped.map((vertex) =>
            scene.projection === 'perspective'
                ? {
                      x: width / 2 + (vertex.x / vertex.z) * focal,
                      y: height / 2 - (vertex.y / vertex.z) * focal,
                  }
                : {
                      x: width / 2 + vertex.x * orthoScale,
                      y: height / 2 - vertex.y * orthoScale,
                  },
        );

        const depth =
            clipped.reduce((total, vertex) => total + vertex.z, 0) /
            clipped.length;

        prepared.push({
            face,
            polygon,
            depth,
            intensity: shadeIntensity(face.vertices),
        });
    });

    prepared.sort((a, b) => {
        if (a.face.layer !== b.face.layer) {
            return a.face.layer - b.face.layer;
        }

        if (a.face.layer < 2) {
            return a.face.order - b.face.order;
        }

        return b.depth - a.depth;
    });

    ctx.save();
    ctx.lineJoin = 'round';

    prepared.forEach(({ face, polygon, intensity }) => {
        const selected =
            face.elementId !== '' && scene.selection.has(face.elementId);
        const hovered =
            face.elementId !== '' && scene.hovered === face.elementId;

        ctx.beginPath();
        ctx.moveTo(polygon[0].x, polygon[0].y);
        polygon.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.closePath();

        if (!wireframe) {
            ctx.globalAlpha = face.opacity ?? 1;
            ctx.fillStyle = selected
                ? shade(CAD_THEME.selection, intensity)
                : hovered
                  ? shade(CAD_THEME.ember, intensity)
                  : hiddenLine
                    ? CAD_THEME.paper
                    : shade(face.color, intensity);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        if (scene.visualStyle !== 'realistic' || selected) {
            ctx.strokeStyle = selected
                ? CAD_THEME.selection
                : hiddenLine || wireframe
                  ? CAD_THEME.ink
                  : 'rgba(30, 28, 26, 0.35)';
            ctx.lineWidth = selected ? 1.6 : 0.7;
            ctx.stroke();
        }
    });

    ctx.restore();

    return prepared
        .filter(({ face }) => face.elementId !== '')
        .sort((a, b) => a.depth - b.depth)
        .map(({ face, polygon, depth }) => ({
            elementId: face.elementId,
            polygon,
            depth,
        }));
}

export function pickAt(targets: PickTarget[], screen: Point): string | null {
    const hit = targets.find((target) =>
        pointInPolygon(screen, target.polygon),
    );

    return hit?.elementId ?? null;
}

function paintBackground(
    ctx: CanvasRenderingContext2D,
    viewport: { width: number; height: number },
    paper: boolean,
): void {
    if (paper) {
        ctx.fillStyle = CAD_THEME.paper;
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        return;
    }

    const gradient = ctx.createLinearGradient(0, 0, 0, viewport.height);
    gradient.addColorStop(0, CAD_THEME.background3dTop);
    gradient.addColorStop(1, CAD_THEME.background3d);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
}

function toCameraSpace(vertex: Vertex, basis: Basis): Vertex {
    const relative: Vertex = {
        x: vertex.x - basis.eye.x,
        y: vertex.y - basis.eye.y,
        z: vertex.z - basis.eye.z,
    };

    return {
        x: dot3(relative, basis.right),
        y: dot3(relative, basis.up),
        z: dot3(relative, basis.forward),
    };
}

/** Sutherland–Hodgman clip against the near plane so nothing folds inside out. */
function clipNear(vertices: Vertex[]): Vertex[] {
    const output: Vertex[] = [];

    for (let index = 0; index < vertices.length; index++) {
        const current = vertices[index];
        const next = vertices[(index + 1) % vertices.length];
        const currentInside = current.z >= NEAR_PLANE;
        const nextInside = next.z >= NEAR_PLANE;

        if (currentInside) {
            output.push(current);
        }

        if (currentInside !== nextInside) {
            const t = (NEAR_PLANE - current.z) / (next.z - current.z);
            output.push({
                x: current.x + (next.x - current.x) * t,
                y: current.y + (next.y - current.y) * t,
                z: NEAR_PLANE,
            });
        }
    }

    return output;
}

/**
 * Flat shading. The absolute dot product lights both sides of a face, which
 * keeps interior surfaces readable without back-face culling.
 */
function shadeIntensity(vertices: Vertex[]): number {
    if (vertices.length < 3) {
        return 1;
    }

    const normal = normalize3(
        cross3(
            subtract3(vertices[1], vertices[0]),
            subtract3(vertices[2], vertices[0]),
        ),
    );
    const lambert = Math.abs(dot3(normal, LIGHT_DIRECTION));

    return AMBIENT_LIGHT + (1 - AMBIENT_LIGHT) * lambert;
}

function shade(hex: string, intensity: number): string {
    const value = hex.replace('#', '');
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    const apply = (channel: number) =>
        Math.round(Math.min(channel * intensity, 255));

    return `rgb(${apply(red)}, ${apply(green)}, ${apply(blue)})`;
}

function subtract3(a: Vertex, b: Vertex): Vertex {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross3(a: Vertex, b: Vertex): Vertex {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function dot3(a: Vertex, b: Vertex): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize3(a: Vertex): Vertex {
    const magnitude = Math.hypot(a.x, a.y, a.z);

    return magnitude < 1e-9
        ? { x: 0, y: 0, z: 0 }
        : {
              x: a.x / magnitude,
              y: a.y / magnitude,
              z: a.z / magnitude,
          };
}

export type ModelBounds = {
    min: Vertex;
    max: Vertex;
};

export function boundsOfFaces(faces: Face[]): ModelBounds | null {
    const vertices = faces
        .filter((face) => face.elementId !== '')
        .flatMap((face) => face.vertices);

    if (vertices.length === 0) {
        return null;
    }

    return vertices.reduce<ModelBounds>(
        (bounds, vertex) => ({
            min: {
                x: Math.min(bounds.min.x, vertex.x),
                y: Math.min(bounds.min.y, vertex.y),
                z: Math.min(bounds.min.z, vertex.z),
            },
            max: {
                x: Math.max(bounds.max.x, vertex.x),
                y: Math.max(bounds.max.y, vertex.y),
                z: Math.max(bounds.max.z, vertex.z),
            },
        }),
        {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
        },
    );
}

/** Frame the whole model, the equivalent of Zoom to Fit in a 3D view. */
export function fitCamera(faces: Face[], camera: OrbitCamera): OrbitCamera {
    const bounds = boundsOfFaces(faces);

    if (!bounds) {
        return camera;
    }

    const span = Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
        4000,
    );

    return {
        ...camera,
        target: {
            x: (bounds.min.x + bounds.max.x) / 2,
            y: (bounds.min.y + bounds.max.y) / 2,
            z: (bounds.min.z + bounds.max.z) / 2,
        },
        distance: span * 2.1,
    };
}
