import { Head, Link } from '@inertiajs/react';
import { ArrowLeft, Eye, Footprints, Info, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { buildModelFaces, groundFaces } from '@/lib/cad/mesh';
import { draw3d, fitCamera, walkOrbit } from '@/lib/cad/render-3d';
import type {
    CadDocument,
    Level,
    OrbitCamera,
    WalkCamera,
} from '@/lib/cad/types';
import {
    clampPitch,
    EYE_HEIGHT,
    startingPose,
    stepWalker,
    wallBarriers,
} from '@/lib/cad/walk';
import { cn } from '@/lib/utils';
import { show } from '@/routes/portal';

type TourProps = {
    drawing: {
        id: number;
        name: string;
        address: string | null;
    };
    model: CadDocument | null;
    whole_building: boolean;
};

/** Walking pace and a hurried one, in millimetres per second. */
const PACE = 1700;
const HURRY = 3800;

/** Radians of turn per pixel of pointer movement. */
const LOOK = 0.0026;

const MOVEMENT_KEYS = new Set([
    'w',
    'a',
    's',
    'd',
    'arrowup',
    'arrowdown',
    'arrowleft',
    'arrowright',
]);

export default function PortalTour({
    drawing,
    model,
    whole_building,
}: TourProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [walking, setWalking] = useState(false);
    const [locked, setLocked] = useState(false);

    const levels = useMemo(() => model?.levels ?? [], [model]);
    const [levelId, setLevelId] = useState(() => levels[0]?.id ?? '');

    const level: Level | null =
        levels.find((item) => item.id === levelId) ?? levels[0] ?? null;

    const faces = useMemo(
        () => (model ? [...groundFaces(model), ...buildModelFaces(model)] : []),
        [model],
    );

    const barriers = useMemo(
        () => (model && level ? wallBarriers(model, level.id) : []),
        [model, level],
    );

    const [orbit, setOrbit] = useState<OrbitCamera>(() =>
        fitCamera(faces, {
            azimuth: Math.PI / 4,
            elevation: 0.5,
            distance: 20000,
            target: { x: 0, y: 0, z: 0 },
        }),
    );

    const [walk, setWalk] = useState<WalkCamera>(() =>
        model && level
            ? startingPose(model, level, barriers)
            : { eye: { x: 0, y: 0, z: EYE_HEIGHT }, yaw: 0, pitch: 0 },
    );

    /* ------------------------------------------------------------- canvas */

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas?.parentElement) {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            setViewport({
                width: Math.floor(entry.contentRect.width),
                height: Math.floor(entry.contentRect.height),
            });
        });

        observer.observe(canvas.parentElement);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx || viewport.width === 0 || viewport.height === 0) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;

        canvas.width = viewport.width * ratio;
        canvas.height = viewport.height * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        draw3d(
            ctx,
            {
                faces,
                camera: walking ? walkOrbit(walk) : orbit,
                projection: 'perspective',
                visualStyle: 'realistic',
                selection: new Set<string>(),
                hovered: null,
                naturalMaterials: true,
            },
            viewport,
        );
    }, [faces, orbit, viewport, walk, walking]);

    /* -------------------------------------------------------- looking round */

    const dragging = useRef<{ x: number; y: number } | null>(null);

    const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (walking) {
            // A click inside the house takes the mouse, so looking around is
            // done by moving it rather than dragging.
            void canvasRef.current?.requestPointerLock();

            return;
        }

        dragging.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const from = dragging.current;

        if (!from) {
            return;
        }

        const dx = event.clientX - from.x;
        const dy = event.clientY - from.y;
        dragging.current = { x: event.clientX, y: event.clientY };

        if (walking) {
            // Touch and unlocked pointers still look around by dragging.
            setWalk((previous) => ({
                ...previous,
                yaw: previous.yaw - dx * LOOK,
                pitch: clampPitch(previous.pitch - dy * LOOK),
            }));

            return;
        }

        setOrbit((previous) => ({
            ...previous,
            azimuth: previous.azimuth - dx * 0.008,
            elevation: Math.min(
                Math.max(previous.elevation + dy * 0.008, -1.2),
                1.4,
            ),
        }));
    };

    const endDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
        dragging.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
    };

    const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
        if (walking) {
            return;
        }

        setOrbit((previous) => ({
            ...previous,
            distance: Math.min(
                Math.max(previous.distance * Math.exp(event.deltaY * 0.001), 800),
                400_000,
            ),
        }));
    };

    // Mouse look, once the pointer belongs to the canvas.
    useEffect(() => {
        if (!walking) {
            return;
        }

        const onLockChange = () => {
            setLocked(document.pointerLockElement === canvasRef.current);
        };

        const onMove = (event: MouseEvent) => {
            if (document.pointerLockElement !== canvasRef.current) {
                return;
            }

            setWalk((previous) => ({
                ...previous,
                yaw: previous.yaw - event.movementX * LOOK,
                pitch: clampPitch(previous.pitch - event.movementY * LOOK),
            }));
        };

        document.addEventListener('pointerlockchange', onLockChange);
        document.addEventListener('mousemove', onMove);

        return () => {
            document.removeEventListener('pointerlockchange', onLockChange);
            document.removeEventListener('mousemove', onMove);
            setLocked(false);
        };
    }, [walking]);

    /* ------------------------------------------------------------- walking */

    const held = useRef(new Set<string>());
    const pushing = useRef(0);

    useEffect(() => {
        const keys = held.current;

        if (!walking) {
            keys.clear();

            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            if (MOVEMENT_KEYS.has(key)) {
                keys.add(key);
                event.preventDefault();
            }

            if (event.shiftKey) {
                keys.add('shift');
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            keys.delete(event.key.toLowerCase());

            if (!event.shiftKey) {
                keys.delete('shift');
            }
        };

        let frame = 0;
        let last = performance.now();

        const tick = (now: number) => {
            // A tab left in the background hands back a huge delta; the sweep
            // in stepWalker keeps that honest, and this keeps it small.
            const seconds = Math.min((now - last) / 1000, 0.1);
            last = now;

            let forward = pushing.current;
            let strafe = 0;

            if (keys.has('w') || keys.has('arrowup')) {
                forward += 1;
            }

            if (keys.has('s') || keys.has('arrowdown')) {
                forward -= 1;
            }

            if (keys.has('d') || keys.has('arrowright')) {
                strafe += 1;
            }

            if (keys.has('a') || keys.has('arrowleft')) {
                strafe -= 1;
            }

            if (forward !== 0 || strafe !== 0) {
                const speed = (keys.has('shift') ? HURRY : PACE) * seconds;

                setWalk((previous) =>
                    stepWalker(
                        previous,
                        barriers,
                        forward * speed,
                        strafe * speed,
                    ),
                );
            }

            frame = requestAnimationFrame(tick);
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        frame = requestAnimationFrame(tick);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            cancelAnimationFrame(frame);
        };
    }, [barriers, walking]);

    const enterWalk = useCallback(() => {
        if (model && level) {
            setWalk(startingPose(model, level, barriers));
        }

        setWalking(true);
    }, [barriers, level, model]);

    const leaveWalk = useCallback(() => {
        setWalking(false);
        document.exitPointerLock?.();
    }, []);

    // Esc leaves the walk, the same key that gives the pointer back.
    useEffect(() => {
        if (!walking) {
            return;
        }

        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !document.pointerLockElement) {
                leaveWalk();
            }
        };

        window.addEventListener('keydown', onKey);

        return () => window.removeEventListener('keydown', onKey);
    }, [leaveWalk, walking]);

    const goToLevel = (next: Level) => {
        setLevelId(next.id);

        if (walking && model) {
            setWalk(startingPose(model, next, wallBarriers(model, next.id)));
        }
    };

    /* ---------------------------------------------------------------- view */

    return (
        <>
            <Head title={`${drawing.name} in 3D`} />

            <div className="flex h-svh flex-col bg-background">
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
                    <Button variant="ghost" size="sm" asChild>
                        <Link href={show()}>
                            <ArrowLeft className="size-4" />
                            Back
                        </Link>
                    </Button>

                    <div className="min-w-0">
                        <h1 className="truncate text-sm font-medium">
                            {drawing.name}
                        </h1>
                        {drawing.address && (
                            <p className="truncate text-xs text-muted-foreground">
                                {drawing.address}
                            </p>
                        )}
                    </div>

                    <div className="ml-auto flex items-center gap-1">
                        {levels.length > 1 && (
                            <div className="mr-2 flex items-center gap-1">
                                {levels.map((item) => (
                                    <Button
                                        key={item.id}
                                        variant={
                                            item.id === level?.id
                                                ? 'secondary'
                                                : 'ghost'
                                        }
                                        size="sm"
                                        onClick={() => goToLevel(item)}
                                    >
                                        {item.name}
                                    </Button>
                                ))}
                            </div>
                        )}

                        <Button
                            variant={walking ? 'ghost' : 'secondary'}
                            size="sm"
                            onClick={leaveWalk}
                        >
                            <Eye className="size-4" />
                            Look round
                        </Button>

                        <Button
                            variant={walking ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={enterWalk}
                            disabled={!model}
                        >
                            <Footprints className="size-4" />
                            Walk inside
                        </Button>
                    </div>
                </header>

                <div className="relative min-h-0 flex-1">
                    {model === null ? (
                        <Empty />
                    ) : (
                        <>
                            <canvas
                                ref={canvasRef}
                                style={{
                                    width: viewport.width,
                                    height: viewport.height,
                                }}
                                className={cn(
                                    'absolute inset-0 touch-none',
                                    walking ? 'cursor-crosshair' : 'cursor-grab',
                                )}
                                onPointerDown={onPointerDown}
                                onPointerMove={onPointerMove}
                                onPointerUp={endDrag}
                                onPointerCancel={endDrag}
                                onWheel={onWheel}
                            />

                            {walking ? (
                                <WalkHints
                                    locked={locked}
                                    onPush={(pushed) => {
                                        pushing.current = pushed;
                                    }}
                                />
                            ) : (
                                <Hint>
                                    Drag to turn the house · scroll to zoom ·
                                    Walk inside to go in
                                </Hint>
                            )}

                            {!whole_building && (
                                <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground">
                                    <Info className="size-3.5" />
                                    One floor only — ask your architect to open
                                    and save the drawing to send the rest
                                </div>
                            )}

                            {!walking && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="absolute top-3 right-3"
                                    onClick={() =>
                                        setOrbit(
                                            fitCamera(faces, {
                                                azimuth: Math.PI / 4,
                                                elevation: 0.5,
                                                distance: 20000,
                                                target: { x: 0, y: 0, z: 0 },
                                            }),
                                        )
                                    }
                                >
                                    <RotateCcw className="size-3.5" />
                                    Reset view
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>
    );
}

function Hint({ children }: { children: React.ReactNode }) {
    return (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-center text-xs text-muted-foreground">
            {children}
        </p>
    );
}

/**
 * What to do once you are inside, plus a thumb-sized way to walk for anyone
 * on a tablet who has no W key to hold.
 */
function WalkHints({
    locked,
    onPush,
}: {
    locked: boolean;
    onPush: (pushed: number) => void;
}) {
    return (
        <>
            <div className="pointer-events-none absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />

            <Hint>
                {locked
                    ? 'W A S D to walk · move the mouse to look · Shift to hurry · Esc to let go'
                    : 'Click to take the mouse · W A S D to walk · drag to look around'}
            </Hint>

            <div className="absolute right-4 bottom-14 flex flex-col gap-2 sm:hidden">
                <PushButton label="Forward" onPush={onPush} amount={1} />
                <PushButton label="Back" onPush={onPush} amount={-1} />
            </div>
        </>
    );
}

function PushButton({
    label,
    amount,
    onPush,
}: {
    label: string;
    amount: number;
    onPush: (pushed: number) => void;
}) {
    return (
        <Button
            variant="secondary"
            size="sm"
            className="select-none"
            onPointerDown={() => onPush(amount)}
            onPointerUp={() => onPush(0)}
            onPointerCancel={() => onPush(0)}
            onPointerLeave={() => onPush(0)}
        >
            {label}
        </Button>
    );
}

function Empty() {
    return (
        <div className="flex h-full items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-muted-foreground">
                There is nothing built in this drawing yet. Once your architect
                has drawn some walls, you will be able to walk through them
                here.
            </p>
        </div>
    );
}
