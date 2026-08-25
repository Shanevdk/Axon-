import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavigationBar } from '@/components/cad/navigation-bar';
import { ViewCube } from '@/components/cad/view-cube';
import type { CadEditor } from '@/hooks/use-cad-editor';
import {
    add,
    angleOf,
    clamp,
    distance,
    intersectSegments,
    projectOnSegment,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import {
    applyGrip,
    flipControlsFor,
    gripsFor,
    GRIP_RADIUS,
    temporaryDimensionAnchor,
    temporaryDimensionsFor,
} from '@/lib/cad/manipulators';
import type { Grip, TemporaryDimension } from '@/lib/cad/manipulators';
import {
    buildOpeningGeometry,
    copyElements,
    createId,
    doorTypeOf,
    elementCategory,
    hitTest,
    hitTestCandidates,
    mirrorElements,
    nextRoomNumber,
    rotateElements,
    translateElements,
    wallTypeOf,
    windowTypeOf,
    withElements,
    withPatchedElement,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import {
    alignWallTo,
    linearArray,
    offsetWall,
    splitWall,
    trimExtendToCorner,
} from '@/lib/cad/modify';
import { draw3d, fitCamera, pickAt } from '@/lib/cad/render-3d';
import type { PickTarget } from '@/lib/cad/render-3d';
import {
    drawPlan,
    flipControlAnchor,
    gripKey,
    placedFootprint,
    screenToWorld,
    worldToScreen,
} from '@/lib/cad/render-plan';
import type { PlanOverlay, Viewport } from '@/lib/cad/render-plan';
import { pointAtDistance, resolveSnap, snapAngle } from '@/lib/cad/snapping';
import type { SnapSettings } from '@/lib/cad/snapping';
import type {
    CadDocument,
    CadElement,
    Point,
    SnapResult,
    ToolId,
} from '@/lib/cad/types';
import {
    drawingIncrement,
    formatDimension,
    formatLength,
    gridSpacing,
    parseLength,
} from '@/lib/cad/units';

/** Zoom applied per wheel tick — kept gentle so scrolling stays controllable. */
const WHEEL_ZOOM_STEP = 1.07;

/** Screen radius within which a flip arrow is picked. */
const FLIP_PICK_RADIUS = 13;

/** Screen radius within which a temporary dimension value is picked. */
const DIMENSION_PICK_RADIUS = 22;

const NO_SNAPS: SnapSettings = {
    endpoint: false,
    midpoint: false,
    intersection: false,
    perpendicular: false,
    nearest: false,
    grid: false,
};

type Pending =
    | { kind: 'none' }
    | { kind: 'chain'; points: Point[]; closable: boolean }
    | { kind: 'rectangle'; start: Point }
    | {
          kind: 'twoPoint';
          start: Point;
          purpose:
              | 'dimension'
              | 'line'
              | 'measure'
              | 'mirror'
              | 'stair'
              | 'grid'
              | 'beam'
              | 'ramp'
              | 'referencePlane'
              | 'section';
      }
    | { kind: 'pickElement'; firstId: string; purpose: 'trim' | 'align' }
    | { kind: 'transform'; base: Point; purpose: 'move' | 'copy' | 'array' }
    | { kind: 'rotate'; centre: Point; startAngle: number };

type Drag =
    | null
    | { kind: 'pan'; screen: Point; center: Point }
    | { kind: 'orbit'; screen: Point; azimuth: number; elevation: number }
    | {
          kind: 'orbitPan';
          screen: Point;
          target: { x: number; y: number; z: number };
      }
    | { kind: 'marquee'; start: Point; current: Point }
    | { kind: 'moveSelection'; start: Point; current: Point; moved: boolean }
    | { kind: 'grip'; grip: Grip; current: Point };

type DrawingCanvasProps = {
    editor: CadEditor;
    onCursorChange: (cursor: Point | null, snap: SnapResult | null) => void;
};

export function DrawingCanvas({ editor, onCursorChange }: DrawingCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pickTargets = useRef<PickTarget[]>([]);

    const [cursor, setCursor] = useState<Point | null>(null);
    const [snap, setSnap] = useState<SnapResult | null>(null);
    const [pending, setPending] = useState<Pending>({ kind: 'none' });
    const [drag, setDrag] = useState<Drag>(null);
    const [textDraft, setTextDraft] = useState<{
        world: Point;
        screen: Point;
    } | null>(null);
    const [shiftHeld, setShiftHeld] = useState(false);
    const [dimensionDraft, setDimensionDraft] = useState<{
        dimension: TemporaryDimension;
        screen: Point;
    } | null>(null);
    const [lengthDraft, setLengthDraft] = useState<{
        value: string;
        screen: Point;
    } | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        screen: Point;
        elementId: string | null;
    } | null>(null);
    const [placementFlip, setPlacementFlip] = useState({
        face: false,
        hand: false,
    });
    /** Index into the elements under the cursor, advanced by Tab. */
    const cycle = useRef(0);

    const {
        document: model,
        activeView,
        level,
        settings,
        geometry,
        camera,
        orbit,
        setViewport,
    } = editor;
    const isModelView =
        activeView.kind === 'threeD' || activeView.kind === 'elevation';

    // Arming a different tool, or changing view, abandons whatever was half drawn.
    const [context, setContext] = useState(
        `${editor.tool}:${editor.activeViewId}`,
    );

    if (context !== `${editor.tool}:${editor.activeViewId}`) {
        setContext(`${editor.tool}:${editor.activeViewId}`);
        setPending({ kind: 'none' });
        setTextDraft(null);
        setDimensionDraft(null);
        setLengthDraft(null);
        setContextMenu(null);
    }

    const viewport: Viewport = useMemo(
        () => ({
            width: editor.viewport.width,
            height: editor.viewport.height,
            camera,
        }),
        [camera, editor.viewport.height, editor.viewport.width],
    );

    /* ------------------------------------------------------------ sizing */

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            setViewport({
                width: Math.round(Math.max(entry.contentRect.width, 1)),
                height: Math.round(Math.max(entry.contentRect.height, 1)),
            });
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, [setViewport]);

    /* ----------------------------------------------------------- helpers */

    /**
     * The blue controls Revit shows on a selection. Only the Modify tool
     * gets them; a placement tool owns the canvas while it is armed.
     */
    const manipulators = useMemo(() => {
        if (editor.tool !== 'select' || editor.selection.length === 0) {
            return null;
        }

        return {
            grips: gripsFor(model, editor.selection, geometry),
            flips: flipControlsFor(model, editor.selection, geometry),
            temporaryDimensions: temporaryDimensionsFor(
                model,
                editor.selection,
                geometry,
            ),
        };
    }, [editor.selection, editor.tool, geometry, model]);

    const snapSettings = editor.snapsEnabled ? editor.snaps : NO_SNAPS;
    const pendingBase = basePointOf(pending);

    const resolve = useCallback(
        (event: {
            clientX: number;
            clientY: number;
            shiftKey: boolean;
        }): SnapResult => {
            const rect = canvasRef.current?.getBoundingClientRect();

            if (!rect) {
                return { point: { x: 0, y: 0 }, kind: 'free' };
            }

            const world = screenToWorld(
                { x: event.clientX - rect.left, y: event.clientY - rect.top },
                viewport,
            );

            return resolveSnap(world, {
                walls: [...geometry.values()],
                settings: snapSettings,
                tolerance: 11 / camera.zoom,
                gridSize: gridSpacing(model.units),
                increment: drawingIncrement(model.units),
                base: pendingBase,
                ortho: editor.ortho || event.shiftKey,
            });
        },
        [
            camera.zoom,
            editor.ortho,
            geometry,
            model.units,
            pendingBase,
            snapSettings,
            viewport,
        ],
    );

    const localPoint = useCallback(
        (event: { clientX: number; clientY: number }): Point => {
            const rect = canvasRef.current?.getBoundingClientRect();

            return rect
                ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
                : { x: 0, y: 0 };
        },
        [],
    );

    const commit = editor.store.commit;

    const cancelPending = useCallback(() => {
        setPending({ kind: 'none' });
        setTextDraft(null);
        setDimensionDraft(null);
        setLengthDraft(null);
    }, []);

    /* --------------------------------------------------------- rendering */

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');

        if (!canvas || !ctx) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(editor.viewport.width * ratio);
        canvas.height = Math.round(editor.viewport.height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        if (isModelView) {
            pickTargets.current = draw3d(
                ctx,
                {
                    faces: editor.faces,
                    camera: orbit,
                    projection:
                        activeView.kind === 'elevation'
                            ? 'orthographic'
                            : 'perspective',
                    visualStyle: settings.visualStyle,
                    selection: new Set(editor.selection),
                    hovered: editor.hovered,
                },
                editor.viewport,
            );

            return;
        }

        drawPlan(
            ctx,
            {
                document: model,
                level: level.id,
                settings,
                geometry,
                rooms: editor.rooms,
                underlay: editor.underlay,
                selection: new Set(editor.selection),
                hovered: editor.hovered,
                units: model.units,
                reflected: activeView.kind === 'ceiling',
                hidden: editor.hidden,
                revealHidden: editor.revealHidden,
                viewName: activeView.name,
            },
            viewport,
            buildOverlay(),
        );
    });

    function buildOverlay(): PlanOverlay {
        const overlay: PlanOverlay = {
            snap,
            manipulators,
            activeGrip: drag?.kind === 'grip' ? gripKey(drag.grip) : null,
        };

        // A grip being dragged shows where it would land, not where it is.
        if (drag?.kind === 'grip' && manipulators) {
            const dragged = gripKey(drag.grip);

            overlay.manipulators = {
                ...manipulators,
                grips: manipulators.grips.map((grip) =>
                    gripKey(grip) === dragged
                        ? { ...grip, point: drag.current }
                        : grip,
                ),
                temporaryDimensions: [],
            };

            if (drag.grip.kind === 'wallEnd') {
                const wall = model.elements.find(
                    (element) => element.id === drag.grip.elementId,
                );

                if (wall?.kind === 'wall') {
                    const other = drag.grip.end === 'a' ? wall.b : wall.a;

                    overlay.previewWalls = [
                        {
                            a: other,
                            b: drag.current,
                            thickness: wallTypeOf(model, wall.typeId).thickness,
                        },
                    ];
                }
            }
        }

        const target = snap?.point ?? cursor;

        if (!target) {
            return overlay;
        }

        const thickness = wallTypeOf(model, editor.wallTypeId).thickness;

        if (pending.kind === 'chain') {
            const points = [...pending.points, target];
            overlay.previewWalls = segmentsOf(points).map(([a, b]) => ({
                a,
                b,
                thickness,
            }));

            if (
                editor.tool === 'floor' ||
                editor.tool === 'roof' ||
                editor.tool === 'ceiling' ||
                editor.tool === 'revisionCloud'
            ) {
                overlay.previewWalls = undefined;
                overlay.previewPolygon = points;
            }
        }

        if (pending.kind === 'rectangle') {
            const corners = rectangleCorners(pending.start, target);
            overlay.previewWalls = segmentsOf([...corners, corners[0]]).map(
                ([a, b]) => ({
                    a,
                    b,
                    thickness,
                }),
            );
        }

        if (pending.kind === 'twoPoint') {
            if (pending.purpose === 'measure') {
                overlay.measure = { a: pending.start, b: target };
            } else if (pending.purpose === 'mirror') {
                overlay.axis = { a: pending.start, b: target };
            } else {
                overlay.rubberBand = { a: pending.start, b: target };
            }
        }

        if (pending.kind === 'transform') {
            overlay.rubberBand = { a: pending.base, b: target };
        }

        if (pending.kind === 'rotate') {
            overlay.axis = { a: pending.centre, b: target };
        }

        if (drag?.kind === 'marquee') {
            overlay.selectionRect = {
                a: drag.start,
                b: drag.current,
                crossing: drag.current.x < drag.start.x,
            };
        }

        if (drag?.kind === 'moveSelection') {
            overlay.rubberBand = { a: drag.start, b: drag.current };
        }

        if (editor.tool === 'door' || editor.tool === 'window') {
            const placement = openingPlacement(editor, target);

            if (placement) {
                overlay.previewOpening = {
                    center: placement.center,
                    direction: placement.host.direction,
                    normal: placement.host.normal,
                    width: placement.width,
                    thickness: placement.host.thickness,
                    kind: editor.tool,
                };
            }
        }

        if (editor.tool === 'column') {
            const half = 400 / 2;
            overlay.previewPolygon = [
                { x: target.x - half, y: target.y - half },
                { x: target.x + half, y: target.y - half },
                { x: target.x + half, y: target.y + half },
                { x: target.x - half, y: target.y + half },
            ];
        }

        return overlay;
    }

    /* ------------------------------------------------------------ export */

    useEffect(() => {
        if (editor.exportToken === 0) {
            return;
        }

        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const link = window.document.createElement('a');
        link.download = `${activeView.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }, [editor.exportToken, activeView.name]);

    /* ------------------------------------------------------- interaction */

    const handlePointerMove = (
        event: React.PointerEvent<HTMLCanvasElement>,
    ) => {
        setShiftHeld(event.shiftKey);

        if (isModelView) {
            handleModelPointerMove(event);

            return;
        }

        const result = resolve(event);
        setCursor(result.point);
        setSnap(result);
        onCursorChange(result.point, result);

        if (drag?.kind === 'pan') {
            const local = localPoint(event);
            editor.setCamera((current) => ({
                ...current,
                center: {
                    x: drag.center.x - (local.x - drag.screen.x) / current.zoom,
                    y: drag.center.y + (local.y - drag.screen.y) / current.zoom,
                },
            }));

            return;
        }

        if (drag?.kind === 'marquee') {
            setDrag({ ...drag, current: result.point });

            return;
        }

        if (drag?.kind === 'moveSelection') {
            setDrag({ ...drag, current: result.point, moved: true });

            return;
        }

        if (drag?.kind === 'grip') {
            setDrag({ ...drag, current: result.point });

            return;
        }

        if (editor.tool === 'select') {
            const hit = hitTest(
                model,
                level.id,
                result.point,
                9 / camera.zoom,
                geometry,
                editor.rooms,
            );
            editor.setHovered(hit?.id ?? null);
        } else if (editor.hovered) {
            editor.setHovered(null);
        }
    };

    const handleModelPointerMove = (
        event: React.PointerEvent<HTMLCanvasElement>,
    ) => {
        if (drag?.kind === 'orbit') {
            const local = localPoint(event);
            editor.setOrbit({
                ...orbit,
                azimuth: drag.azimuth - (local.x - drag.screen.x) * 0.008,
                elevation: clamp(
                    drag.elevation + (local.y - drag.screen.y) * 0.006,
                    -1.45,
                    1.45,
                ),
            });

            return;
        }

        if (drag?.kind === 'orbitPan') {
            const local = localPoint(event);
            const scaleFactor = orbit.distance / 900;
            const cos = Math.cos(orbit.azimuth);
            const sin = Math.sin(orbit.azimuth);
            const dx = -(local.x - drag.screen.x) * scaleFactor;
            const dy = (local.y - drag.screen.y) * scaleFactor;

            editor.setOrbit({
                ...orbit,
                target: {
                    x: drag.target.x + dx * -sin + dy * -cos,
                    y: drag.target.y + dx * cos + dy * -sin,
                    z: drag.target.z,
                },
            });

            return;
        }

        const hit = pickAt(pickTargets.current, localPoint(event));
        editor.setHovered(hit);
        onCursorChange(null, null);
    };

    const handlePointerDown = (
        event: React.PointerEvent<HTMLCanvasElement>,
    ) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();

        if (event.button === 2) {
            return;
        }

        if (isModelView) {
            if (event.button === 1 || event.shiftKey) {
                setDrag({
                    kind: 'orbitPan',
                    screen: localPoint(event),
                    target: orbit.target,
                });
            } else {
                setDrag({
                    kind: 'orbit',
                    screen: localPoint(event),
                    azimuth: orbit.azimuth,
                    elevation: orbit.elevation,
                });
            }

            return;
        }

        if (event.button === 1) {
            setDrag({
                kind: 'pan',
                screen: localPoint(event),
                center: camera.center,
            });

            return;
        }

        const result = resolve(event);

        if (editor.tool === 'select') {
            const screen = localPoint(event);
            const toScreen = (p: Point) => worldToScreen(p, viewport);

            // Manipulators sit on top of the model and are picked first.
            const flip = manipulators?.flips.find(
                (control) =>
                    distance(flipControlAnchor(control, toScreen), screen) <=
                    FLIP_PICK_RADIUS,
            );

            if (flip) {
                commit(
                    flip.axis === 'face' ? 'Flip facing' : 'Flip hand',
                    (current) => {
                        const opening = current.elements.find(
                            (element) => element.id === flip.elementId,
                        );

                        if (
                            opening?.kind !== 'door' &&
                            opening?.kind !== 'window'
                        ) {
                            return current;
                        }

                        return withPatchedElement(current, flip.elementId, {
                            [flip.axis === 'face' ? 'flipFace' : 'flipHand']:
                                flip.axis === 'face'
                                    ? !opening.flipFace
                                    : !opening.flipHand,
                        });
                    },
                );

                return;
            }

            const grip = manipulators?.grips.find(
                (candidate) =>
                    distance(toScreen(candidate.point), screen) <=
                    GRIP_RADIUS + 4,
            );

            if (grip) {
                setDrag({ kind: 'grip', grip, current: grip.point });
                editor.setStatus('Drag the grip, or press Escape to cancel');

                return;
            }

            const dimension = manipulators?.temporaryDimensions.find(
                (candidate) =>
                    distance(
                        toScreen(temporaryDimensionAnchor(candidate)),
                        screen,
                    ) <= DIMENSION_PICK_RADIUS,
            );

            if (dimension) {
                setDimensionDraft({
                    dimension,
                    screen: toScreen(temporaryDimensionAnchor(dimension)),
                });

                return;
            }

            const hit = hitTest(
                model,
                level.id,
                result.point,
                9 / camera.zoom,
                geometry,
                editor.rooms,
            );
            // Revit's convention: Ctrl adds to a selection, Shift removes.
            const adding = event.ctrlKey || event.metaKey;
            const removing = event.shiftKey;

            if (
                hit &&
                editor.selection.includes(hit.id) &&
                !adding &&
                !removing
            ) {
                setDrag({
                    kind: 'moveSelection',
                    start: result.point,
                    current: result.point,
                    moved: false,
                });

                return;
            }

            if (hit) {
                editor.setSelection(
                    removing
                        ? editor.selection.filter((id) => id !== hit.id)
                        : adding
                          ? [...new Set([...editor.selection, hit.id])]
                          : [hit.id],
                );

                return;
            }

            setDrag({
                kind: 'marquee',
                start: result.point,
                current: result.point,
            });

            if (!adding && !removing) {
                editor.setSelection([]);
            }
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (event.button === 2) {
            return;
        }

        if (drag?.kind === 'marquee') {
            applyMarquee(editor, drag.start, drag.current);
            setDrag(null);

            return;
        }

        if (drag?.kind === 'grip') {
            const grip = drag.grip;
            const target = drag.current;

            commit('Edit geometry', (current) =>
                applyGrip(current, grip, target, geometry),
            );
            setDrag(null);
            editor.setStatus('Geometry edited');

            return;
        }

        if (drag?.kind === 'moveSelection') {
            if (drag.moved) {
                const delta = subtract(drag.current, drag.start);
                commit('Move', (current) =>
                    translateElements(current, editor.selection, delta),
                );
                editor.setStatus(
                    `Moved ${formatDimension(distance(drag.start, drag.current), model.units)}`,
                );
            }

            setDrag(null);

            return;
        }

        if (drag) {
            setDrag(null);

            return;
        }

        if (isModelView) {
            const hit = pickAt(pickTargets.current, localPoint(event));
            editor.setSelection(hit ? [hit] : []);

            return;
        }

        if (editor.tool !== 'select') {
            handleToolClick(resolve(event).point);
        }
    };

    function handleToolClick(worldPoint: Point) {
        const tool = editor.tool;

        switch (tool) {
            case 'wall':
                handleWallClick(worldPoint);
                break;
            case 'floor':
            case 'roof':
            case 'ceiling':
            case 'revisionCloud':
                handleSketchClick(worldPoint);
                break;
            case 'stair':
            case 'grid':
            case 'beam':
            case 'ramp':
            case 'referencePlane':
            case 'section':
                handleTwoPointClick(worldPoint, tool);
                break;
            case 'trim':
            case 'align':
                handlePickElement(worldPoint, tool);
                break;
            case 'split':
                handleSplit(worldPoint);
                break;
            case 'offset':
                handleOffset(worldPoint);
                break;
            case 'door':
            case 'window':
                placeOpening(worldPoint);
                break;
            case 'column':
                placeColumn(worldPoint);
                break;
            case 'room':
                placeRoom(worldPoint);
                break;
            case 'text':
                setTextDraft({
                    world: worldPoint,
                    screen: worldToScreen(worldPoint, viewport),
                });
                break;
            case 'dimension':
            case 'line':
            case 'measure':
            case 'mirror':
                handleTwoPointClick(worldPoint, tool);
                break;
            case 'move':
            case 'copy':
            case 'array':
                handleTransformClick(worldPoint, tool);
                break;
            case 'rotate':
                handleRotateClick(worldPoint);
                break;
            default:
                break;
        }
    }

    function handleWallClick(worldPoint: Point) {
        if (editor.drawMode === 'rectangle') {
            if (pending.kind !== 'rectangle') {
                setPending({ kind: 'rectangle', start: worldPoint });

                return;
            }

            const corners = rectangleCorners(pending.start, worldPoint);
            createWalls(segmentsOf([...corners, corners[0]]));
            setPending({ kind: 'none' });

            return;
        }

        const points = pending.kind === 'chain' ? pending.points : [];

        if (points.length === 0) {
            setPending({
                kind: 'chain',
                points: [worldPoint],
                closable: editor.drawMode === 'polygon',
            });

            return;
        }

        if (editor.drawMode === 'polygon') {
            const first = points[0];

            if (
                points.length >= 2 &&
                distance(worldPoint, first) < 24 / camera.zoom
            ) {
                createWalls(segmentsOf([...points, first]));
                setPending({ kind: 'none' });

                return;
            }

            setPending({
                kind: 'chain',
                points: [...points, worldPoint],
                closable: true,
            });

            return;
        }

        // Chained line mode places each segment as it is confirmed.
        createWalls([[points[points.length - 1], worldPoint]]);
        setPending({ kind: 'chain', points: [worldPoint], closable: false });
    }

    function createWalls(segments: [Point, Point][]) {
        const elements: CadElement[] = segments
            .filter(([a, b]) => distance(a, b) > 1)
            .map(([a, b]) => ({
                id: createId('wall'),
                kind: 'wall' as const,
                level: level.id,
                typeId: editor.wallTypeId,
                a,
                b,
                height: editor.wallHeight,
                baseOffset: 0,
                locationLine: editor.locationLine,
            }));

        if (elements.length === 0) {
            return;
        }

        commit('Draw wall', (current) => withElements(current, elements));
        editor.setStatus(
            `${elements.length} wall${elements.length > 1 ? 's' : ''} added`,
        );
    }

    function handleSketchClick(worldPoint: Point) {
        const points = pending.kind === 'chain' ? pending.points : [];

        if (
            points.length >= 3 &&
            distance(worldPoint, points[0]) < 24 / camera.zoom
        ) {
            finishSketch(points);

            return;
        }

        setPending({
            kind: 'chain',
            points: [...points, worldPoint],
            closable: true,
        });
    }

    const finishSketch = useCallback(
        (points: Point[]) => {
            if (points.length < 3) {
                setPending({ kind: 'none' });

                return;
            }

            const tool = editor.tool;

            if (tool === 'roof') {
                commit('Create roof', (current) =>
                    withElements(current, [
                        {
                            id: createId('roof'),
                            kind: 'roof',
                            level: level.id,
                            points,
                            slope: editor.roofSlope,
                            overhang: editor.roofOverhang,
                            baseOffset: editor.wallHeight,
                        },
                    ]),
                );
                editor.setStatus('Roof created');
            } else if (tool === 'revisionCloud') {
                const count = model.elements.filter(
                    (element) => element.kind === 'revisionCloud',
                ).length;

                commit('Create revision cloud', (current) =>
                    withElements(current, [
                        {
                            id: createId('revcloud'),
                            kind: 'revisionCloud',
                            level: level.id,
                            points,
                            revision: String(count + 1),
                        },
                    ]),
                );
                editor.setStatus('Revision cloud placed');
            } else if (tool === 'ceiling') {
                commit('Create ceiling', (current) =>
                    withElements(current, [
                        {
                            id: createId('ceiling'),
                            kind: 'ceiling',
                            level: level.id,
                            points,
                            heightOffset: 2700,
                        },
                    ]),
                );
                editor.setStatus('Ceiling created');
            } else {
                commit('Create floor', (current) =>
                    withElements(current, [
                        {
                            id: createId('floor'),
                            kind: 'floor',
                            level: level.id,
                            points,
                            thickness: 300,
                            offset: 0,
                        },
                    ]),
                );
                editor.setStatus('Floor created');
            }

            setPending({ kind: 'none' });
        },
        [commit, editor, level.id],
    );

    function placeOpening(worldPoint: Point) {
        const placement = openingPlacement(editor, worldPoint);

        if (!placement) {
            editor.setStatus('Openings must be placed in a wall');

            return;
        }

        const kind = editor.tool === 'door' ? 'door' : 'window';

        commit('Place opening', (current) =>
            withElements(current, [
                {
                    id: createId(kind),
                    kind,
                    level: level.id,
                    typeId:
                        kind === 'door'
                            ? editor.doorTypeId
                            : editor.windowTypeId,
                    host: placement.host.wall.id,
                    t: placement.t,
                    flipFace: placementFlip.face,
                    flipHand: placementFlip.hand,
                },
            ]),
        );
        editor.setStatus(`${kind === 'door' ? 'Door' : 'Window'} placed`);
    }

    function placeColumn(worldPoint: Point) {
        commit('Place column', (current) =>
            withElements(current, [
                {
                    id: createId('column'),
                    kind: 'column',
                    level: level.id,
                    p: worldPoint,
                    size: 400,
                    rotation: 0,
                    height: editor.wallHeight,
                },
            ]),
        );
        editor.setStatus('Column placed');
    }

    function placeRoom(worldPoint: Point) {
        commit('Place room', (current) =>
            withElements(current, [
                {
                    id: createId('room'),
                    kind: 'room',
                    level: level.id,
                    p: worldPoint,
                    name: 'Room',
                    number: nextRoomNumber(current, level.id),
                },
            ]),
        );
        editor.setStatus('Room placed');
    }

    function handleTwoPointClick(
        worldPoint: Point,
        purpose:
            | 'dimension'
            | 'line'
            | 'measure'
            | 'mirror'
            | 'stair'
            | 'grid'
            | 'beam'
            | 'ramp'
            | 'referencePlane'
            | 'section',
    ) {
        if (pending.kind !== 'twoPoint') {
            setPending({ kind: 'twoPoint', start: worldPoint, purpose });

            return;
        }

        const start = pending.start;

        if (purpose === 'measure') {
            editor.setStatus(
                `Measured ${formatDimension(distance(start, worldPoint), model.units)}`,
            );
            setPending({ kind: 'none' });

            return;
        }

        if (
            purpose === 'stair' ||
            purpose === 'grid' ||
            purpose === 'beam' ||
            purpose === 'ramp' ||
            purpose === 'referencePlane' ||
            purpose === 'section'
        ) {
            createLinearElement(purpose, start, worldPoint);
            setPending({ kind: 'none' });

            return;
        }

        if (purpose === 'mirror') {
            if (editor.selection.length > 0) {
                commit('Mirror', (current) =>
                    mirrorElements(
                        current,
                        editor.selection,
                        start,
                        worldPoint,
                    ),
                );
                editor.setStatus('Mirrored selection');
            }

            setPending({ kind: 'none' });

            return;
        }

        commit(
            purpose === 'dimension' ? 'Add dimension' : 'Draw line',
            (current) =>
                withElements(current, [
                    purpose === 'dimension'
                        ? {
                              id: createId('dimension'),
                              kind: 'dimension',
                              level: level.id,
                              a: start,
                              b: worldPoint,
                              offset: 900,
                          }
                        : {
                              id: createId('line'),
                              kind: 'line',
                              level: level.id,
                              a: start,
                              b: worldPoint,
                          },
                ]),
        );
        setPending({ kind: 'none' });
    }

    /**
     * Stairs, grids and beams are all placed by two clicks along their run.
     */
    function createLinearElement(
        purpose:
            'stair' | 'grid' | 'beam' | 'ramp' | 'referencePlane' | 'section',
        start: Point,
        end: Point,
    ) {
        if (distance(start, end) < 100) {
            editor.setStatus('Pick two points further apart');

            return;
        }

        if (purpose === 'stair') {
            const levels = model.levels;
            const index = levels.findIndex((item) => item.id === level.id);
            const above = levels[index + 1];
            const rise = above
                ? above.elevation - level.elevation
                : editor.wallHeight;

            commit('Create stair', (current) =>
                withElements(current, [
                    {
                        id: createId('stair'),
                        kind: 'stair',
                        level: level.id,
                        a: start,
                        b: end,
                        width: editor.stairWidth,
                        rise: Math.max(rise, 600),
                    },
                ]),
            );
            editor.setStatus('Stair created');

            return;
        }

        if (purpose === 'grid') {
            const label = nextGridLabel(model, start, end);

            commit('Create grid', (current) =>
                withElements(current, [
                    {
                        id: createId('grid'),
                        kind: 'grid',
                        level: level.id,
                        a: start,
                        b: end,
                        label,
                    },
                ]),
            );
            editor.setStatus(`Grid ${label} placed`);

            return;
        }

        if (purpose === 'ramp') {
            const levels = model.levels;
            const index = levels.findIndex((item) => item.id === level.id);
            const above = levels[index + 1];

            commit('Create ramp', (current) =>
                withElements(current, [
                    {
                        id: createId('ramp'),
                        kind: 'ramp',
                        level: level.id,
                        a: start,
                        b: end,
                        width: editor.stairWidth,
                        rise: above
                            ? above.elevation - level.elevation
                            : Math.min(distance(start, end) / 12, 1500),
                    },
                ]),
            );
            editor.setStatus('Ramp created');

            return;
        }

        if (purpose === 'referencePlane') {
            commit('Create reference plane', (current) =>
                withElements(current, [
                    {
                        id: createId('refplane'),
                        kind: 'referencePlane',
                        level: level.id,
                        a: start,
                        b: end,
                        name: '',
                    },
                ]),
            );
            editor.setStatus('Reference plane placed');

            return;
        }

        if (purpose === 'section') {
            const count = model.elements.filter(
                (element) => element.kind === 'section',
            ).length;

            commit('Create section', (current) =>
                withElements(current, [
                    {
                        id: createId('section'),
                        kind: 'section',
                        level: level.id,
                        a: start,
                        b: end,
                        name: `Section ${count + 1}`,
                    },
                ]),
            );
            editor.setStatus(
                'Section placed — open it from the Project Browser',
            );

            return;
        }

        commit('Create beam', (current) =>
            withElements(current, [
                {
                    id: createId('beam'),
                    kind: 'beam',
                    level: level.id,
                    a: start,
                    b: end,
                    width: editor.beamSize.width,
                    depth: editor.beamSize.depth,
                    elevation: editor.wallHeight,
                },
            ]),
        );
        editor.setStatus('Beam created');
    }

    /**
     * Trim/Extend and Align both pick two walls in sequence: the first is
     * the reference, the second is modified.
     */
    function handlePickElement(worldPoint: Point, purpose: 'trim' | 'align') {
        const hit = hitTest(
            model,
            level.id,
            worldPoint,
            9 / camera.zoom,
            geometry,
            editor.rooms,
        );

        if (hit?.kind !== 'wall') {
            editor.setStatus(
                purpose === 'trim'
                    ? 'Trim/Extend works on walls — click a wall'
                    : 'Align works on walls — click the reference wall',
            );

            return;
        }

        if (pending.kind !== 'pickElement') {
            setPending({ kind: 'pickElement', firstId: hit.id, purpose });
            editor.setStatus(
                purpose === 'trim'
                    ? 'Now click the second wall to form the corner'
                    : 'Now click the wall to align to the reference',
            );

            return;
        }

        const firstId = pending.firstId;
        setPending({ kind: 'none' });

        if (purpose === 'trim') {
            const result = trimExtendToCorner(model, firstId, hit.id);

            if (!result) {
                editor.setStatus(
                    'Those walls are parallel — no corner to form',
                );

                return;
            }

            commit('Trim/Extend to corner', () => result);
            editor.setStatus('Corner formed');

            return;
        }

        const aligned = alignWallTo(model, firstId, hit.id);

        if (!aligned) {
            editor.setStatus('Could not align those walls');

            return;
        }

        commit('Align', () => aligned);
        editor.setStatus('Aligned');
    }

    function handleSplit(worldPoint: Point) {
        const hit = hitTest(
            model,
            level.id,
            worldPoint,
            9 / camera.zoom,
            geometry,
            editor.rooms,
        );

        if (hit?.kind !== 'wall') {
            editor.setStatus('Split works on walls — click along a wall');

            return;
        }

        const result = splitWall(model, hit.id, worldPoint);

        if (!result) {
            editor.setStatus('Too close to the wall end to split there');

            return;
        }

        commit('Split wall', () => result.document);
        editor.setStatus('Wall split');
    }

    function handleOffset(worldPoint: Point) {
        const hit = hitTest(
            model,
            level.id,
            worldPoint,
            Math.max(9 / camera.zoom, editor.offsetDistance),
            geometry,
            editor.rooms,
        );

        if (hit?.kind !== 'wall') {
            editor.setStatus('Offset works on walls — click beside a wall');

            return;
        }

        const result = offsetWall(
            model,
            hit.id,
            editor.offsetDistance,
            worldPoint,
        );

        if (!result) {
            editor.setStatus('Could not offset that wall');

            return;
        }

        commit('Offset wall', () => result.document);
        editor.setStatus(
            `Offset ${formatDimension(editor.offsetDistance, model.units)}`,
        );
    }

    function handleTransformClick(
        worldPoint: Point,
        purpose: 'move' | 'copy' | 'array',
    ) {
        if (editor.selection.length === 0) {
            editor.setStatus('Select something to transform first');

            return;
        }

        if (pending.kind !== 'transform') {
            setPending({ kind: 'transform', base: worldPoint, purpose });

            return;
        }

        const delta = subtract(worldPoint, pending.base);

        if (purpose === 'array') {
            commit('Array', (current) =>
                linearArray(
                    current,
                    editor.selection,
                    delta,
                    Math.max(editor.arrayCount, 2),
                ),
            );
            setPending({ kind: 'none' });
            editor.setStatus(
                `Arrayed ${Math.max(editor.arrayCount, 2)} instances`,
            );

            return;
        }

        commit(purpose === 'move' ? 'Move' : 'Copy', (current) =>
            purpose === 'move'
                ? translateElements(current, editor.selection, delta)
                : copyElements(current, editor.selection, delta).document,
        );
        setPending({ kind: 'none' });
        editor.setStatus(
            purpose === 'move' ? 'Moved selection' : 'Copied selection',
        );
    }

    function handleRotateClick(worldPoint: Point) {
        if (editor.selection.length === 0) {
            editor.setStatus('Select something to rotate first');

            return;
        }

        if (pending.kind !== 'rotate') {
            setPending({
                kind: 'rotate',
                centre: worldPoint,
                startAngle: Number.NaN,
            });

            return;
        }

        const currentAngle = angleOf(subtract(worldPoint, pending.centre));
        const reference = Number.isNaN(pending.startAngle)
            ? 0
            : pending.startAngle;
        const rotation = snapAngle(currentAngle - reference);

        commit('Rotate', (current) =>
            rotateElements(current, editor.selection, pending.centre, rotation),
        );
        setPending({ kind: 'none' });
        editor.setStatus('Rotated selection');
    }

    /* --------------------------------------------------------- keyboard */

    useEffect(() => {
        const isTyping = (target: EventTarget | null): boolean => {
            const node = target as HTMLElement | null;

            return (
                !!node &&
                (node.tagName === 'INPUT' ||
                    node.tagName === 'TEXTAREA' ||
                    node.isContentEditable)
            );
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (isTyping(event.target)) {
                return;
            }

            if (event.key === 'Escape') {
                // First Escape abandons the sketch, a second clears the
                // selection and drops back to Modify, as Revit does.
                if (pending.kind !== 'none' || textDraft || dimensionDraft) {
                    cancelPending();
                } else if (editor.selection.length > 0) {
                    editor.clearSelection();
                } else if (editor.tool !== 'select') {
                    editor.setTool('select');
                }

                if (drag?.kind === 'grip') {
                    setDrag(null);
                }

                return;
            }

            if (event.key === 'Enter' && pending.kind === 'chain') {
                if (
                    editor.tool === 'floor' ||
                    editor.tool === 'roof' ||
                    editor.tool === 'ceiling' ||
                    editor.tool === 'revisionCloud'
                ) {
                    finishSketch(pending.points);
                } else if (pending.points.length >= 2) {
                    createWallsFromChain(pending.points);
                }

                return;
            }

            // Tab cycles the prehighlight through everything under the cursor.
            if (event.key === 'Tab' && !isModelView && cursor) {
                event.preventDefault();

                const candidates = hitTestCandidates(
                    model,
                    level.id,
                    cursor,
                    9 / camera.zoom,
                    geometry,
                    editor.rooms,
                );

                if (candidates.length === 0) {
                    return;
                }

                cycle.current =
                    (cycle.current + 1) % Math.max(candidates.length, 1);
                editor.setHovered(candidates[cycle.current].id);
                editor.setStatus(
                    `${elementCategory(candidates[cycle.current].kind)} — Tab for next`,
                );

                return;
            }

            // Space flips whatever is selected, or the pending placement.
            if (event.key === ' ') {
                event.preventDefault();
                flipUnderway(event.shiftKey);

                return;
            }

            // Typing a number while a placement is underway overrides the
            // length, exactly like typing into Revit's temporary dimension.
            if (
                /^[0-9]$/.test(event.key) &&
                pendingBase &&
                cursor &&
                !lengthDraft
            ) {
                setLengthDraft({
                    value: event.key,
                    screen: worldToScreen(cursor, viewport),
                });

                return;
            }

            if (event.key === 'Shift') {
                setShiftHeld(true);
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Shift') {
                setShiftHeld(false);
            }
        };

        const createWallsFromChain = (points: Point[]) => {
            createWalls(segmentsOf(points));
            setPending({ kind: 'none' });
        };

        /**
         * Flip the selected openings, or the one about to be placed. Shift
         * flips the hand rather than the facing.
         */
        const flipUnderway = (hand: boolean) => {
            if (editor.tool === 'door' || editor.tool === 'window') {
                setPlacementFlip((previous) => ({
                    ...previous,
                    [hand ? 'hand' : 'face']: !previous[hand ? 'hand' : 'face'],
                }));

                return;
            }

            const openings = model.elements.filter(
                (element) =>
                    editor.selection.includes(element.id) &&
                    (element.kind === 'door' || element.kind === 'window'),
            );

            if (openings.length === 0) {
                return;
            }

            commit(hand ? 'Flip hand' : 'Flip facing', (current) =>
                openings.reduce((document, opening) => {
                    const target = document.elements.find(
                        (element) => element.id === opening.id,
                    );

                    if (target?.kind !== 'door' && target?.kind !== 'window') {
                        return document;
                    }

                    return withPatchedElement(document, opening.id, {
                        [hand ? 'flipHand' : 'flipFace']: hand
                            ? !target.flipHand
                            : !target.flipFace,
                    });
                }, current),
            );
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    });

    /* ------------------------------------------------------------- wheel */

    useEffect(() => {
        const canvas = canvasRef.current;

        if (!canvas) {
            return;
        }

        const onWheel = (event: WheelEvent) => {
            event.preventDefault();

            if (isModelView) {
                editor.setOrbit({
                    ...orbit,
                    distance: clamp(
                        orbit.distance * (event.deltaY > 0 ? 1.06 : 1 / 1.06),
                        2000,
                        400_000,
                    ),
                });

                return;
            }

            const rect = canvas.getBoundingClientRect();
            const local = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
            };
            const before = screenToWorld(local, viewport);
            const factor =
                event.deltaY > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP;

            editor.setCamera((current) => {
                const zoom = clamp(current.zoom * factor, 0.0008, 2);
                const after = screenToWorld(local, {
                    ...viewport,
                    camera: { ...current, zoom },
                });

                return {
                    zoom,
                    center: {
                        x: current.center.x + (before.x - after.x),
                        y: current.center.y + (before.y - after.y),
                    },
                };
            });
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });

        return () => canvas.removeEventListener('wheel', onWheel);
    }, [editor, isModelView, orbit, viewport]);

    const zoomBy = (factor: number) => {
        if (isModelView) {
            editor.setOrbit({
                ...orbit,
                distance: clamp(orbit.distance / factor, 2000, 400_000),
            });

            return;
        }

        editor.setCamera((current) => ({
            ...current,
            zoom: clamp(current.zoom * factor, 0.0008, 2),
        }));
    };

    const zoomSelection = () => {
        const points = model.elements
            .filter((element) => editor.selection.includes(element.id))
            .flatMap((element) => elementPoints(editor, element));

        if (points.length === 0) {
            return;
        }

        const minX = Math.min(...points.map((p) => p.x)) - 1200;
        const maxX = Math.max(...points.map((p) => p.x)) + 1200;
        const minY = Math.min(...points.map((p) => p.y)) - 1200;
        const maxY = Math.max(...points.map((p) => p.y)) + 1200;

        editor.setCamera({
            zoom: clamp(
                Math.min(
                    editor.viewport.width / Math.max(maxX - minX, 1),
                    editor.viewport.height / Math.max(maxY - minY, 1),
                ) * 0.92,
                0.0008,
                2,
            ),
            center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        });
    };

    /* ------------------------------------------------------------ render */

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full overflow-hidden bg-chrome-sunken"
        >
            <canvas
                ref={canvasRef}
                tabIndex={0}
                style={{
                    width: editor.viewport.width,
                    height: editor.viewport.height,
                }}
                className={cursorClass(editor.tool, drag, isModelView)}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={() => {
                    setCursor(null);
                    setSnap(null);
                    onCursorChange(null, null);
                }}
                onContextMenu={(event) => {
                    event.preventDefault();

                    if (pending.kind !== 'none') {
                        cancelPending();

                        return;
                    }

                    if (isModelView) {
                        return;
                    }

                    const world = resolve(event).point;
                    const hit = hitTest(
                        model,
                        level.id,
                        world,
                        9 / camera.zoom,
                        geometry,
                        editor.rooms,
                    );

                    // Right-clicking an unselected element selects it first.
                    if (hit && !editor.selection.includes(hit.id)) {
                        editor.setSelection([hit.id]);
                    }

                    setContextMenu({
                        screen: localPoint(event),
                        elementId: hit?.id ?? null,
                    });
                }}
            />

            <div
                className={
                    isModelView
                        ? 'absolute top-40 right-3 z-10'
                        : 'absolute top-3 right-3 z-10'
                }
            >
                <NavigationBar
                    onZoomIn={() => zoomBy(1.25)}
                    onZoomOut={() => zoomBy(1 / 1.25)}
                    onZoomFit={editor.zoomFit}
                    onZoomSelection={
                        !isModelView && editor.selection.length > 0
                            ? zoomSelection
                            : null
                    }
                />
            </div>

            {isModelView && (
                <ViewCube
                    camera={orbit}
                    onOrient={(azimuth, elevation) =>
                        editor.setOrbit({ ...orbit, azimuth, elevation })
                    }
                    onHome={() =>
                        editor.setOrbit(
                            fitCamera(editor.faces, {
                                ...orbit,
                                azimuth: -Math.PI / 4,
                                elevation: Math.PI / 5,
                            }),
                        )
                    }
                />
            )}

            {shiftHeld && !isModelView && (
                <div className="pointer-events-none absolute bottom-3 left-3 rounded-sm bg-ink/80 px-2 py-1 text-[0.7rem] text-paper">
                    Orthogonal constraint
                </div>
            )}

            {textDraft && (
                <input
                    autoFocus
                    placeholder="Text note…"
                    style={{
                        left: textDraft.screen.x,
                        top: textDraft.screen.y,
                    }}
                    className="absolute z-10 -translate-y-1/2 rounded-sm border border-sand bg-paper px-2 py-1 text-sm text-ink outline-none"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setTextDraft(null);
                        }

                        if (event.key === 'Enter') {
                            const value = event.currentTarget.value.trim();

                            if (value !== '') {
                                commit('Add text', (current) =>
                                    withElements(current, [
                                        {
                                            id: createId('text'),
                                            kind: 'text',
                                            level: level.id,
                                            p: textDraft.world,
                                            value,
                                            size: 120,
                                        },
                                    ]),
                                );
                            }

                            setTextDraft(null);
                        }
                    }}
                    onBlur={() => setTextDraft(null)}
                />
            )}
            {lengthDraft && (
                <input
                    autoFocus
                    value={lengthDraft.value}
                    aria-label="Length"
                    onChange={(event) =>
                        setLengthDraft({
                            ...lengthDraft,
                            value: event.target.value,
                        })
                    }
                    style={{
                        left: lengthDraft.screen.x + 16,
                        top: lengthDraft.screen.y - 30,
                    }}
                    className="absolute z-10 w-28 rounded-sm border border-sand bg-paper px-1.5 py-1 text-sm text-ink tabular-nums outline-none"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setLengthDraft(null);

                            return;
                        }

                        if (event.key !== 'Enter') {
                            return;
                        }

                        const parsed = parseLength(
                            lengthDraft.value,
                            model.units,
                        );

                        if (
                            parsed !== null &&
                            parsed > 0 &&
                            pendingBase &&
                            cursor
                        ) {
                            handleToolClick(
                                pointAtDistance(pendingBase, cursor, parsed),
                            );
                        }

                        setLengthDraft(null);
                    }}
                    onBlur={() => setLengthDraft(null)}
                />
            )}

            {dimensionDraft && (
                <input
                    autoFocus
                    aria-label="Dimension"
                    defaultValue={formatLength(
                        dimensionDraft.dimension.value,
                        model.units,
                    )}
                    style={{
                        left: dimensionDraft.screen.x,
                        top: dimensionDraft.screen.y,
                    }}
                    className="absolute z-10 w-28 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-sand bg-paper px-1.5 py-1 text-center text-sm text-ink tabular-nums outline-none"
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setDimensionDraft(null);

                            return;
                        }

                        if (event.key !== 'Enter') {
                            return;
                        }

                        const parsed = parseLength(
                            event.currentTarget.value,
                            model.units,
                        );

                        if (parsed !== null && parsed > 0) {
                            const { apply } = dimensionDraft.dimension;

                            commit('Edit dimension', (current) =>
                                apply(current, parsed),
                            );
                            editor.setStatus('Dimension applied');
                        }

                        setDimensionDraft(null);
                    }}
                    onBlur={() => setDimensionDraft(null)}
                />
            )}
            {contextMenu && (
                <CanvasContextMenu
                    editor={editor}
                    screen={contextMenu.screen}
                    elementId={contextMenu.elementId}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}

type CanvasContextMenuProps = {
    editor: CadEditor;
    screen: Point;
    elementId: string | null;
    onClose: () => void;
};

/**
 * The right-click menu, carrying the entries Revit puts on an element.
 */
function CanvasContextMenu({
    editor,
    screen,
    elementId,
    onClose,
}: CanvasContextMenuProps) {
    const element = elementId
        ? editor.document.elements.find((item) => item.id === elementId)
        : undefined;

    const run = (action: () => void) => () => {
        action();
        onClose();
    };

    const selectAllInstances = () => {
        if (!element) {
            return;
        }

        const typeId = 'typeId' in element ? element.typeId : null;

        editor.setSelection(
            editor.document.elements
                .filter(
                    (item) =>
                        item.kind === element.kind &&
                        item.level === element.level &&
                        (typeId === null ||
                            ('typeId' in item && item.typeId === typeId)),
                )
                .map((item) => item.id),
        );
    };

    const createSimilar = () => {
        const tools: Partial<Record<CadElement['kind'], ToolId>> = {
            wall: 'wall',
            door: 'door',
            window: 'window',
            column: 'column',
            floor: 'floor',
            room: 'room',
            dimension: 'dimension',
            text: 'text',
            line: 'line',
        };

        const tool = element ? tools[element.kind] : undefined;

        if (tool) {
            editor.setTool(tool);
        }
    };

    const items: (
        | { kind: 'separator' }
        | {
              kind: 'item';
              label: string;
              onSelect: () => void;
              disabled?: boolean;
          }
    )[] = [
        {
            kind: 'item',
            label: 'Cancel',
            onSelect: run(() => editor.setTool('select')),
        },
        {
            kind: 'item',
            label: 'Create Similar',
            onSelect: run(createSimilar),
            disabled: !element,
        },
        { kind: 'separator' },
        {
            kind: 'item',
            label: 'Select All Instances',
            onSelect: run(selectAllInstances),
            disabled: !element,
        },
        {
            kind: 'item',
            label: 'Delete',
            onSelect: run(editor.deleteSelection),
            disabled: editor.selection.length === 0,
        },
        { kind: 'separator' },
        {
            kind: 'item',
            label: 'Hide in View',
            onSelect: run(editor.hideSelection),
            disabled: editor.selection.length === 0,
        },
        {
            kind: 'item',
            label: 'Isolate Element',
            onSelect: run(editor.isolateSelection),
            disabled: editor.selection.length === 0,
        },
        {
            kind: 'item',
            label: 'Reset Temporary Hide/Isolate',
            onSelect: run(editor.resetTemporaryHide),
            disabled: editor.hidden.size === 0,
        },
        { kind: 'separator' },
        {
            kind: 'item',
            label: 'Zoom to Fit',
            onSelect: run(editor.zoomFit),
        },
    ];

    return (
        <>
            <div
                className="fixed inset-0 z-20"
                onPointerDown={onClose}
                onContextMenu={(event) => {
                    event.preventDefault();
                    onClose();
                }}
            />
            <div
                role="menu"
                style={{ left: screen.x, top: screen.y }}
                className="absolute z-30 min-w-52 rounded-sm border border-chrome-border bg-chrome-raised py-1 text-[0.78rem] text-chrome-fg shadow-lg"
            >
                {items.map((item, index) =>
                    item.kind === 'separator' ? (
                        <div
                            key={`separator-${index}`}
                            className="my-1 h-px bg-chrome-border"
                        />
                    ) : (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            onClick={item.onSelect}
                            className="flex w-full items-center px-3 py-1.5 text-left transition-colors hover:bg-chrome/70 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                            {item.label}
                        </button>
                    ),
                )}
            </div>
        </>
    );
}

/* ------------------------------------------------------------- utilities */

/**
 * Next free grid label: vertical-ish grids count 1, 2, 3 and horizontal-ish
 * grids letter A, B, C, following the usual structural convention.
 */
function nextGridLabel(document: CadDocument, a: Point, b: Point): string {
    const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    const used = new Set(
        document.elements
            .filter((element) => element.kind === 'grid')
            .map((element) => (element as { label: string }).label),
    );

    if (vertical) {
        for (let number = 1; number < 100; number++) {
            if (!used.has(String(number))) {
                return String(number);
            }
        }

        return String(used.size + 1);
    }

    for (let index = 0; index < 26; index++) {
        const letter = String.fromCharCode(65 + index);

        if (!used.has(letter)) {
            return letter;
        }
    }

    return `G${used.size + 1}`;
}

function basePointOf(pending: Pending): Point | null {
    switch (pending.kind) {
        case 'chain':
            return pending.points[pending.points.length - 1] ?? null;
        case 'rectangle':
            return pending.start;
        case 'twoPoint':
            return pending.start;
        case 'transform':
            return pending.base;
        case 'rotate':
            return pending.centre;
        default:
            return null;
    }
}

function segmentsOf(points: Point[]): [Point, Point][] {
    const segments: [Point, Point][] = [];

    for (let index = 0; index < points.length - 1; index++) {
        segments.push([points[index], points[index + 1]]);
    }

    return segments;
}

function rectangleCorners(a: Point, b: Point): Point[] {
    return [
        { x: a.x, y: a.y },
        { x: b.x, y: a.y },
        { x: b.x, y: b.y },
        { x: a.x, y: b.y },
    ];
}

type Placement = {
    host: WallGeometry;
    t: number;
    center: Point;
    width: number;
};

/** Find the wall under the cursor and the position an opening would take. */
function openingPlacement(editor: CadEditor, world: Point): Placement | null {
    const width =
        editor.tool === 'door'
            ? doorTypeOf(editor.document, editor.doorTypeId).width
            : windowTypeOf(editor.document, editor.windowTypeId).width;

    let best: Placement | null = null;
    let bestDistance = Infinity;

    editor.geometry.forEach((wall) => {
        if (wall.wall.level !== editor.level.id) {
            return;
        }

        const projection = projectOnSegment(world, wall.a, wall.b);
        const reach = Math.max(wall.thickness, 400);

        if (projection.distance > reach || projection.distance > bestDistance) {
            return;
        }

        const margin = wall.length > width ? width / 2 / wall.length : 0.5;
        const t = clamp(projection.t, margin, 1 - margin);

        bestDistance = projection.distance;
        best = {
            host: wall,
            t,
            center: add(wall.a, scale(subtract(wall.b, wall.a), t)),
            width,
        };
    });

    return best;
}

function elementPoints(editor: CadEditor, element: CadElement): Point[] {
    switch (element.kind) {
        case 'wall':
            return (
                editor.geometry.get(element.id)?.polygon ?? [
                    element.a,
                    element.b,
                ]
            );
        case 'door':
        case 'window': {
            const host = editor.geometry.get(element.host);

            return host
                ? buildOpeningGeometry(editor.document, element, host).polygon
                : [];
        }
        case 'floor':
            return element.points;
        case 'column': {
            const half = element.size / 2;

            return [
                { x: element.p.x - half, y: element.p.y - half },
                { x: element.p.x + half, y: element.p.y - half },
                { x: element.p.x + half, y: element.p.y + half },
                { x: element.p.x - half, y: element.p.y + half },
            ];
        }
        case 'room':
        case 'text':
            return [element.p];
        case 'dimension':
        case 'line':
            return [element.a, element.b];
        case 'stair':
        case 'grid':
        case 'beam':
        case 'ramp':
        case 'referencePlane':
        case 'section':
            return [element.a, element.b];
        case 'roof':
        case 'ceiling':
        case 'revisionCloud':
            return element.points;
        case 'mesh':
            return placedFootprint(element);
    }
}

function applyMarquee(editor: CadEditor, start: Point, end: Point) {
    const crossing = end.x < start.x;
    const rect = {
        minX: Math.min(start.x, end.x),
        maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y),
    };

    if (rect.maxX - rect.minX < 1 && rect.maxY - rect.minY < 1) {
        return;
    }

    const corners = [
        { x: rect.minX, y: rect.minY },
        { x: rect.maxX, y: rect.minY },
        { x: rect.maxX, y: rect.maxY },
        { x: rect.minX, y: rect.maxY },
    ];

    const inside = (p: Point) =>
        p.x >= rect.minX &&
        p.x <= rect.maxX &&
        p.y >= rect.minY &&
        p.y <= rect.maxY;

    const matched = editor.document.elements
        .filter((element) => element.level === editor.level.id)
        .filter((element) => {
            const points = elementPoints(editor, element);

            if (points.length === 0) {
                return false;
            }

            if (!crossing) {
                return points.every(inside);
            }

            if (points.some(inside)) {
                return true;
            }

            if (points.length === 1) {
                return false;
            }

            // A crossing window also catches anything the box cuts through.
            return points.some((current, index) => {
                const next = points[(index + 1) % points.length];

                return corners.some(
                    (corner, cornerIndex) =>
                        intersectSegments(
                            current,
                            next,
                            corner,
                            corners[(cornerIndex + 1) % corners.length],
                        ) !== null,
                );
            });
        })
        .map((element) => element.id);

    editor.setSelection(matched);
    editor.setStatus(
        matched.length > 0
            ? `${matched.length} elements selected`
            : 'Nothing selected',
    );
}

function cursorClass(tool: string, drag: Drag, isModelView: boolean): string {
    if (drag?.kind === 'pan' || drag?.kind === 'orbitPan') {
        return 'cursor-grabbing outline-none';
    }

    if (isModelView) {
        return drag?.kind === 'orbit'
            ? 'cursor-grabbing outline-none'
            : 'cursor-grab outline-none';
    }

    return tool === 'select'
        ? 'cursor-default outline-none'
        : 'cursor-crosshair outline-none';
}
