import { Maximize2, Move3d } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PART_COLOUR, readHex } from '@/lib/cad/library';
import type { ItemScene } from '@/lib/cad/library';
import { cn } from '@/lib/utils';

type DesignerViewportProps = {
    scene: ItemScene;
    /** The part being edited, drawn lit and outlined. */
    selectedId: string | null;
    /** Clicking a part in the view selects it in the list. */
    onSelect: (partId: string) => void;
};

type Camera = { azimuth: number; elevation: number; zoom: number };

const START_CAMERA: Camera = {
    azimuth: -Math.PI / 4,
    elevation: Math.PI / 7,
    zoom: 1,
};

/** Sun direction, fixed so the item reads the same however you spin it. */
const SUN = normalise3([-0.45, 0.4, 0.8]);

/** A second, dimmer light from the opposite side, so backs are not flat. */
const FILL = normalise3([0.5, -0.3, 0.35]);

/**
 * The item designer's 3D view: the thing you are building, shaded in its own
 * materials, on a ground plane you can spin with a mouse, a pencil or a
 * finger.
 *
 * Painter's algorithm on a plain 2D canvas — the same approach as the
 * editor's 3D viewport. The pieces are already compiled, so this only
 * projects, sorts and fills.
 */
export function DesignerViewport({
    scene,
    selectedId,
    onSelect,
}: DesignerViewportProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [camera, setCamera] = useState<Camera>(START_CAMERA);
    const [size, setSize] = useState({ width: 800, height: 520 });

    // The triangles as last drawn, in screen space, for picking.
    const painted = useRef<{ partId: string; points: [number, number][] }[]>(
        [],
    );

    const drag = useRef<{
        x: number;
        y: number;
        moved: boolean;
        pointer: number;
    } | null>(null);

    // Follow the panel as it is resized.
    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas?.parentElement) {
            return;
        }

        const parent = canvas.parentElement;
        const observer = new ResizeObserver(() => {
            setSize({
                width: Math.max(200, parent.clientWidth),
                height: Math.max(200, parent.clientHeight),
            });
        });

        observer.observe(parent);

        return () => observer.disconnect();
    }, []);

    // Draw whenever the item, the camera or the panel changes.
    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');

        if (!canvas || !context) {
            return;
        }

        painted.current = paint(
            context,
            canvas,
            scene,
            camera,
            size,
            selectedId,
        );
    }, [scene, camera, size, selectedId]);

    return (
        <div className="relative h-full w-full touch-none select-none">
            <canvas
                ref={canvasRef}
                className="h-full w-full cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = {
                        x: event.clientX,
                        y: event.clientY,
                        moved: false,
                        pointer: event.pointerId,
                    };
                }}
                onPointerMove={(event) => {
                    const from = drag.current;

                    if (!from || from.pointer !== event.pointerId) {
                        return;
                    }

                    const dx = event.clientX - from.x;
                    const dy = event.clientY - from.y;

                    if (Math.hypot(dx, dy) > 3) {
                        from.moved = true;
                    }

                    drag.current = {
                        ...from,
                        x: event.clientX,
                        y: event.clientY,
                    };

                    setCamera((current) => ({
                        ...current,
                        azimuth: current.azimuth - dx * 0.01,
                        // Stop just short of the poles, where the view flips.
                        elevation: Math.max(
                            -Math.PI / 2 + 0.05,
                            Math.min(
                                Math.PI / 2 - 0.05,
                                current.elevation + dy * 0.01,
                            ),
                        ),
                    }));
                }}
                onPointerUp={(event) => {
                    const from = drag.current;

                    drag.current = null;

                    // A tap, not a spin: pick whatever is under it.
                    if (from && !from.moved) {
                        const canvas = canvasRef.current;

                        if (!canvas) {
                            return;
                        }

                        const box = canvas.getBoundingClientRect();
                        const hit = pick(painted.current, [
                            event.clientX - box.left,
                            event.clientY - box.top,
                        ]);

                        if (hit) {
                            onSelect(hit);
                        }
                    }
                }}
                onPointerCancel={() => {
                    drag.current = null;
                }}
                onWheel={(event) => {
                    setCamera((current) => ({
                        ...current,
                        zoom: Math.max(
                            0.25,
                            Math.min(
                                4,
                                current.zoom * (event.deltaY > 0 ? 0.9 : 1.1),
                            ),
                        ),
                    }));
                }}
            />

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-3 py-2 text-[0.65rem] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <Move3d className="size-3.5" />
                    drag to spin · scroll to zoom · tap a part to select
                </span>

                <button
                    type="button"
                    onClick={() => setCamera(START_CAMERA)}
                    className={cn(
                        'pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-card/80 px-2 py-0.5 backdrop-blur transition-colors hover:text-foreground',
                    )}
                >
                    <Maximize2 className="size-3" />
                    reset view
                </button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------- rendering */

type PaintedFace = { partId: string; points: [number, number][] };

/**
 * Project, sort and fill. Returns what was drawn, in screen space, so a tap
 * can be tested against exactly what the eye sees.
 */
function paint(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    scene: ItemScene,
    camera: Camera,
    size: { width: number; height: number },
    selectedId: string | null,
): PaintedFace[] {
    const ratio = window.devicePixelRatio || 1;

    canvas.width = size.width * ratio;
    canvas.height = size.height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);

    if (scene.mesh.triangleCount === 0) {
        return [];
    }

    const cosA = Math.cos(camera.azimuth);
    const sinA = Math.sin(camera.azimuth);
    const cosE = Math.cos(camera.elevation);
    const sinE = Math.sin(camera.elevation);

    /** World millimetres to the camera's flat frame. */
    const project = (x: number, y: number, z: number) => {
        const px = x * cosA - y * sinA;
        const py = x * sinA + y * cosA;

        return {
            x: px,
            y: -(z * cosE - py * sinE),
            depth: py * cosE + z * sinE,
        };
    };

    // Fit the item to the panel, then apply the wheel's zoom.
    const { size: extent } = scene.mesh;
    const reach = Math.max(extent.x, extent.y, extent.z, 1);
    const scale =
        (Math.min(size.width, size.height) / (reach * 1.9)) * camera.zoom;
    const midZ = extent.z / 2;

    const toScreen = (point: { x: number; y: number }) => ({
        x: size.width / 2 + point.x * scale,
        y: size.height / 2 + (point.y + midZ * cosE) * scale,
    });

    type Face = {
        partId: string;
        points: [number, number][];
        depth: number;
        fill: string;
    };

    const faces: Face[] = [];

    for (const piece of scene.pieces) {
        const base = readHex(piece.colour || DEFAULT_PART_COLOUR);
        const chosen = piece.partId === selectedId;

        for (let index = 0; index + 8 < piece.vertices.length; index += 9) {
            const corners: [number, number][] = [];
            let depth = 0;

            for (let corner = 0; corner < 3; corner++) {
                const projected = project(
                    piece.vertices[index + corner * 3],
                    piece.vertices[index + corner * 3 + 1],
                    piece.vertices[index + corner * 3 + 2],
                );
                const screen = toScreen(projected);

                corners.push([screen.x, screen.y]);
                depth += projected.depth;
            }

            const normal = faceNormal(piece.vertices, index);

            // Cull the backs: the camera looks along this direction.
            const toCamera: [number, number, number] = [
                sinA * cosE,
                cosA * cosE,
                sinE,
            ];

            if (dot3(normal, toCamera) <= 0) {
                continue;
            }

            // Key light, a dim fill, and an ambient floor so nothing is black.
            const lit =
                0.34 +
                Math.max(0, dot3(normal, SUN)) * 0.72 +
                Math.max(0, dot3(normal, FILL)) * 0.16;

            const tint = chosen ? 1.16 : 1;
            const [r, g, b] = base.map((channel) =>
                Math.max(0, Math.min(255, Math.round(channel * lit * tint))),
            );

            faces.push({
                partId: piece.partId,
                points: corners,
                depth: depth / 3,
                fill: `rgb(${r},${g},${b})`,
            });
        }
    }

    drawGround(context, size, scene, camera, scale, midZ, cosE);

    // Painter's algorithm: furthest first.
    faces.sort((a, b) => a.depth - b.depth);

    for (const face of faces) {
        context.beginPath();
        context.moveTo(face.points[0][0], face.points[0][1]);
        context.lineTo(face.points[1][0], face.points[1][1]);
        context.lineTo(face.points[2][0], face.points[2][1]);
        context.closePath();
        context.fillStyle = face.fill;
        context.fill();
        // Hairline in the fill colour closes the seams antialiasing leaves.
        context.strokeStyle = face.fill;
        context.lineWidth = 0.6;
        context.stroke();
    }

    if (selectedId) {
        outlineSelection(context, faces, selectedId);
    }

    return faces.map((face) => ({
        partId: face.partId,
        points: face.points,
    }));
}

/**
 * A soft shadow and a light grid, so the item is standing on something
 * rather than floating in a void.
 */
function drawGround(
    context: CanvasRenderingContext2D,
    size: { width: number; height: number },
    scene: ItemScene,
    camera: Camera,
    scale: number,
    midZ: number,
    cosE: number,
): void {
    const cosA = Math.cos(camera.azimuth);
    const sinA = Math.sin(camera.azimuth);
    const sinE = Math.sin(camera.elevation);
    const reach = Math.max(scene.mesh.size.x, scene.mesh.size.y, 1) * 1.4;

    const floor = (x: number, y: number) => {
        const px = x * cosA - y * sinA;
        const py = x * sinA + y * cosA;

        return {
            x: size.width / 2 + px * scale,
            y: size.height / 2 + (py * sinE + midZ * cosE) * scale,
        };
    };

    // The contact shadow, an ellipse squashed by the camera's tilt.
    const centre = floor(0, 0);
    const shadow = context.createRadialGradient(
        centre.x,
        centre.y,
        0,
        centre.x,
        centre.y,
        (reach / 2) * scale,
    );

    shadow.addColorStop(0, 'rgba(0,0,0,0.22)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');

    context.save();
    context.translate(centre.x, centre.y);
    context.scale(1, Math.max(0.08, cosE));
    context.translate(-centre.x, -centre.y);
    context.beginPath();
    context.arc(centre.x, centre.y, (reach / 2) * scale, 0, Math.PI * 2);
    context.fillStyle = shadow;
    context.fill();
    context.restore();

    // A grid at a round spacing, fading out at the edge of the pad.
    const step = reach / 6;

    context.strokeStyle = 'rgba(0,0,0,0.07)';
    context.lineWidth = 1;

    for (let line = -3; line <= 3; line++) {
        const along = line * step;

        const a = floor(along, -reach / 2);
        const b = floor(along, reach / 2);
        const c = floor(-reach / 2, along);
        const d = floor(reach / 2, along);

        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.moveTo(c.x, c.y);
        context.lineTo(d.x, d.y);
        context.stroke();
    }
}

/**
 * Trace the selected part so it is unmistakable, without hiding its material.
 */
function outlineSelection(
    context: CanvasRenderingContext2D,
    faces: { partId: string; points: [number, number][] }[],
    selectedId: string,
): void {
    context.save();
    context.strokeStyle = 'rgba(246,139,33,0.9)';
    context.lineWidth = 1.4;
    context.lineJoin = 'round';

    for (const face of faces) {
        if (face.partId !== selectedId) {
            continue;
        }

        context.beginPath();
        context.moveTo(face.points[0][0], face.points[0][1]);
        context.lineTo(face.points[1][0], face.points[1][1]);
        context.lineTo(face.points[2][0], face.points[2][1]);
        context.closePath();
        context.stroke();
    }

    context.restore();
}

/**
 * Which part was tapped: the last face painted over that point, since that
 * is the one on top.
 */
function pick(faces: PaintedFace[], at: [number, number]): string | null {
    for (let index = faces.length - 1; index >= 0; index--) {
        if (inTriangle(at, faces[index].points)) {
            return faces[index].partId;
        }
    }

    return null;
}

function inTriangle(
    point: [number, number],
    triangle: [number, number][],
): boolean {
    const [a, b, c] = triangle;
    const sign = (
        p: [number, number],
        q: [number, number],
        r: [number, number],
    ) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);

    const d1 = sign(point, a, b);
    const d2 = sign(point, b, c);
    const d3 = sign(point, c, a);

    const negative = d1 < 0 || d2 < 0 || d3 < 0;
    const positive = d1 > 0 || d2 > 0 || d3 > 0;

    return !(negative && positive);
}

/* ---------------------------------------------------------------- vectors */

function faceNormal(
    vertices: number[],
    index: number,
): [number, number, number] {
    const ax = vertices[index];
    const ay = vertices[index + 1];
    const az = vertices[index + 2];
    const u = [
        vertices[index + 3] - ax,
        vertices[index + 4] - ay,
        vertices[index + 5] - az,
    ];
    const v = [
        vertices[index + 6] - ax,
        vertices[index + 7] - ay,
        vertices[index + 8] - az,
    ];

    return normalise3([
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ]);
}

function normalise3(vector: number[]): [number, number, number] {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;

    return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function dot3(a: number[], b: number[]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
