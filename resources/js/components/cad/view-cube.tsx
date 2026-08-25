import { House } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { pointInPolygon } from '@/lib/cad/geometry';
import { cameraBasis } from '@/lib/cad/render-3d';
import { CAD_THEME } from '@/lib/cad/theme';
import type { OrbitCamera, Point } from '@/lib/cad/types';

const SIZE = 96;

type CubeFace = {
    label: string;
    normal: [number, number, number];
    /** Corners in cube space, wound so the outward normal is consistent. */
    corners: [number, number, number][];
    azimuth: number;
    elevation: number;
};

const FACES: CubeFace[] = [
    {
        label: 'E',
        normal: [1, 0, 0],
        corners: [
            [1, -1, -1],
            [1, 1, -1],
            [1, 1, 1],
            [1, -1, 1],
        ],
        azimuth: 0,
        elevation: 0,
    },
    {
        label: 'W',
        normal: [-1, 0, 0],
        corners: [
            [-1, 1, -1],
            [-1, -1, -1],
            [-1, -1, 1],
            [-1, 1, 1],
        ],
        azimuth: Math.PI,
        elevation: 0,
    },
    {
        label: 'N',
        normal: [0, 1, 0],
        corners: [
            [1, 1, -1],
            [-1, 1, -1],
            [-1, 1, 1],
            [1, 1, 1],
        ],
        azimuth: Math.PI / 2,
        elevation: 0,
    },
    {
        label: 'S',
        normal: [0, -1, 0],
        corners: [
            [-1, -1, -1],
            [1, -1, -1],
            [1, -1, 1],
            [-1, -1, 1],
        ],
        azimuth: -Math.PI / 2,
        elevation: 0,
    },
    {
        label: 'TOP',
        normal: [0, 0, 1],
        corners: [
            [-1, -1, 1],
            [1, -1, 1],
            [1, 1, 1],
            [-1, 1, 1],
        ],
        azimuth: -Math.PI / 2,
        elevation: Math.PI / 2 - 0.02,
    },
    {
        label: 'BOT',
        normal: [0, 0, -1],
        corners: [
            [-1, 1, -1],
            [1, 1, -1],
            [1, -1, -1],
            [-1, -1, -1],
        ],
        azimuth: -Math.PI / 2,
        elevation: -(Math.PI / 2 - 0.02),
    },
];

type ViewCubeProps = {
    camera: OrbitCamera;
    onOrient: (azimuth: number, elevation: number) => void;
    onHome: () => void;
};

/**
 * A working ViewCube: it is drawn with the same camera as the model, so it
 * turns as the scene turns, and clicking a face snaps to that elevation.
 */
export function ViewCube({ camera, onOrient, onHome }: ViewCubeProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const project = useCallback(
        (corner: [number, number, number]): Point => {
            const basis = cameraBasis({
                ...camera,
                target: { x: 0, y: 0, z: 0 },
                distance: 10,
            });
            const relative = {
                x: corner[0] - basis.eye.x,
                y: corner[1] - basis.eye.y,
                z: corner[2] - basis.eye.z,
            };
            const x =
                relative.x * basis.right.x +
                relative.y * basis.right.y +
                relative.z * basis.right.z;
            const y =
                relative.x * basis.up.x +
                relative.y * basis.up.y +
                relative.z * basis.up.z;
            const scale = SIZE * 0.26;

            return { x: SIZE / 2 + x * scale, y: SIZE / 2 - y * scale };
        },
        [camera],
    );

    const visibleFaces = useCallback(() => {
        const basis = cameraBasis({
            ...camera,
            target: { x: 0, y: 0, z: 0 },
            distance: 10,
        });

        return FACES.filter((face) => {
            const facing =
                face.normal[0] * basis.forward.x +
                face.normal[1] * basis.forward.y +
                face.normal[2] * basis.forward.z;

            return facing < -0.05;
        });
    }, [camera]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        canvas.width = SIZE * ratio;
        canvas.height = SIZE * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.clearRect(0, 0, SIZE, SIZE);

        ctx.font = '600 9px Karla, ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        visibleFaces().forEach((face) => {
            const polygon = face.corners.map(project);

            ctx.beginPath();
            ctx.moveTo(polygon[0].x, polygon[0].y);
            polygon.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
            ctx.closePath();

            ctx.fillStyle =
                face.label === 'TOP'
                    ? 'rgba(194,171,146,0.35)'
                    : 'rgba(232,227,220,0.14)';
            ctx.fill();
            ctx.strokeStyle = CAD_THEME.sand;
            ctx.lineWidth = 1;
            ctx.stroke();

            const centre = polygon.reduce(
                (total, p) => ({ x: total.x + p.x / 4, y: total.y + p.y / 4 }),
                { x: 0, y: 0 },
            );

            ctx.fillStyle = '#f0e9e1';
            ctx.fillText(face.label, centre.x, centre.y);
        });
    }, [project, visibleFaces]);

    return (
        <div className="pointer-events-auto absolute top-3 right-3 flex flex-col items-center gap-1">
            <canvas
                ref={canvasRef}
                width={SIZE}
                height={SIZE}
                style={{ width: SIZE, height: SIZE }}
                className="cursor-pointer"
                onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const local = {
                        x: event.clientX - rect.left,
                        y: event.clientY - rect.top,
                    };
                    const hit = visibleFaces().find((face) =>
                        pointInPolygon(local, face.corners.map(project)),
                    );

                    if (hit) {
                        onOrient(hit.azimuth, hit.elevation);
                    }
                }}
            />
            <button
                type="button"
                onClick={onHome}
                title="Home view"
                className="rounded-sm border border-chrome-border bg-chrome/80 p-1 text-chrome-fg backdrop-blur transition-colors hover:text-sand"
            >
                <House className="size-3.5" />
            </button>
        </div>
    );
}
