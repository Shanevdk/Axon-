import {
    add,
    angleOf,
    distance,
    lerp,
    midpoint,
    normalize,
    perpendicular,
    polygonCentroid,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import { FLIP_OFFSET, GRIP_RADIUS } from '@/lib/cad/manipulators';
import type {
    FlipControl,
    Grip,
    TemporaryDimension,
} from '@/lib/cad/manipulators';
import {
    buildOpeningGeometry,
    doorTypeOf,
    fixtureFootprint,
    wallLayers,
    windowTypeOf,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import type { RoomBoundary } from '@/lib/cad/rooms';
import { expandFootprint, roofRidge, stairSteps } from '@/lib/cad/solids';
import { CAD_THEME } from '@/lib/cad/theme';
import type {
    BeamElement,
    BraceElement,
    CableTrayElement,
    CadDocument,
    Camera,
    CeilingElement,
    ColumnElement,
    CropRegion,
    DetailLevel,
    DimensionElement,
    DuctElement,
    DuctSystem,
    FixtureElement,
    FloorElement,
    FootingElement,
    GridElement,
    LineElement,
    MeshElement,
    OpeningElement,
    PadElement,
    Phase,
    PipeElement,
    PipeSystem,
    Point,
    PropertyLineElement,
    RailingElement,
    RampElement,
    ReferencePlaneElement,
    RevisionCloudElement,
    RoofElement,
    SectionElement,
    RoomElement,
    SnapResult,
    SpotElevationElement,
    WalkthroughElement,
    StairElement,
    TextElement,
    ToposurfaceElement,
    Units,
    ViewSettings,
} from '@/lib/cad/types';
import {
    formatArea,
    formatDimension,
    formatLength,
    formatScale,
} from '@/lib/cad/units';

/** Thickness of a door leaf in plan, in millimetres. */
const DOOR_LEAF = 45;

/** Paper-space gap between a dimension witness line and what it measures. */
const WITNESS_GAP = 4;

/** Paper-space overshoot of a witness line past the dimension line. */
const WITNESS_EXTENSION = 5;

export type Viewport = {
    width: number;
    height: number;
    camera: Camera;
};

export type PlanOverlay = {
    snap?: SnapResult | null;
    previewWalls?: { a: Point; b: Point; thickness: number }[];
    previewPolygon?: Point[] | null;
    /** An open polyline being sketched, such as a walkthrough path. */
    previewPath?: Point[] | null;
    previewOpening?: {
        center: Point;
        direction: Point;
        normal: Point;
        width: number;
        thickness: number;
        kind: 'door' | 'window';
    } | null;
    rubberBand?: { a: Point; b: Point } | null;
    selectionRect?: { a: Point; b: Point; crossing: boolean } | null;
    measure?: { a: Point; b: Point } | null;
    axis?: { a: Point; b: Point } | null;
    /** Selection controls: grips, flip arrows and temporary dimensions. */
    manipulators?: {
        grips: Grip[];
        flips: FlipControl[];
        temporaryDimensions: TemporaryDimension[];
    } | null;
    /** Key of the grip currently being dragged, from `gripKey`. */
    activeGrip?: string | null;
};

export type PlanScene = {
    document: CadDocument;
    level: string;
    settings: ViewSettings;
    geometry: Map<string, WallGeometry>;
    rooms: Map<string, RoomBoundary>;
    underlay: WallGeometry[];
    selection: Set<string>;
    hovered: string | null;
    units: Units;
    reflected: boolean;
    /** Elements taken out of the view by Hide or Isolate. */
    hidden: Set<string>;
    /** Draw hidden elements back in, greyed, the way Reveal Hidden does. */
    revealHidden: boolean;
    /** Name shown in the view title under the drawing. */
    viewName: string;
};

export function worldToScreen(p: Point, viewport: Viewport): Point {
    const { camera, width, height } = viewport;

    return {
        x: (p.x - camera.center.x) * camera.zoom + width / 2,
        y: height / 2 - (p.y - camera.center.y) * camera.zoom,
    };
}

export function screenToWorld(p: Point, viewport: Viewport): Point {
    const { camera, width, height } = viewport;

    return {
        x: (p.x - width / 2) / camera.zoom + camera.center.x,
        y: (height / 2 - p.y) / camera.zoom + camera.center.y,
    };
}

/** Visible model rectangle, used to cull the background grid. */
export function visibleBounds(viewport: Viewport) {
    const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
    const bottomRight = screenToWorld(
        { x: viewport.width, y: viewport.height },
        viewport,
    );

    return {
        minX: topLeft.x,
        maxX: bottomRight.x,
        minY: bottomRight.y,
        maxY: topLeft.y,
    };
}

export function drawPlan(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    viewport: Viewport,
    overlay: PlanOverlay,
): void {
    const toScreen = (p: Point) => worldToScreen(p, viewport);

    ctx.save();
    ctx.fillStyle = CAD_THEME.paper;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    if (scene.settings.showGrid) {
        drawGrid(ctx, scene, viewport);
    }

    const crop = cropRectangle(scene);

    if (crop && scene.settings.cropView) {
        const topLeft = toScreen({ x: crop.minX, y: crop.maxY });
        const bottomRight = toScreen({ x: crop.maxX, y: crop.minY });

        ctx.save();
        ctx.beginPath();
        ctx.rect(
            topLeft.x,
            topLeft.y,
            bottomRight.x - topLeft.x,
            bottomRight.y - topLeft.y,
        );
        ctx.clip();
    }

    drawGridLines(ctx, scene, toScreen);
    drawReferencePlanes(ctx, scene, toScreen);
    drawPropertyLines(ctx, scene, toScreen);
    drawUnderlay(ctx, scene, toScreen);

    if (scene.revealHidden) {
        drawRevealedHidden(ctx, scene, toScreen);
    }

    drawToposurfaces(ctx, scene, toScreen);
    drawPads(ctx, scene, toScreen);
    drawFloors(ctx, scene, toScreen);

    if (scene.settings.showRooms) {
        drawRoomFills(ctx, scene, toScreen);
    }

    drawWalls(ctx, scene, viewport, toScreen);
    drawOpenings(ctx, scene, toScreen);
    drawFootings(ctx, scene, toScreen);
    drawColumns(ctx, scene, toScreen);
    drawBeams(ctx, scene, toScreen);
    drawBraces(ctx, scene, toScreen);
    drawStairs(ctx, scene, toScreen);
    drawRamps(ctx, scene, toScreen);
    drawRailings(ctx, scene, toScreen);
    drawCeilings(ctx, scene, toScreen);
    drawRoofs(ctx, scene, toScreen);
    drawMeshes(ctx, scene, toScreen);
    drawFixtures(ctx, scene, toScreen);
    drawDucts(ctx, scene, toScreen);
    drawCableTrays(ctx, scene, toScreen);
    drawPipes(ctx, scene, toScreen);
    drawDetailLines(ctx, scene, toScreen);
    drawDimensions(ctx, scene, toScreen);

    if (scene.settings.showTags) {
        drawRoomTags(ctx, scene, toScreen);
        drawTextNotes(ctx, scene, toScreen);
        drawOpeningTags(ctx, scene, toScreen);
        drawSpotElevations(ctx, scene, toScreen);
        drawWalkthroughs(ctx, scene, toScreen);
        drawElevationMarkers(ctx, scene, toScreen);
        drawSectionMarks(ctx, scene, toScreen);
    }

    drawRevisionClouds(ctx, scene, toScreen);

    drawHighlights(ctx, scene, toScreen);

    if (crop && scene.settings.cropView) {
        ctx.restore();
    }

    if (crop && scene.settings.showCrop) {
        drawCropBoundary(ctx, crop, toScreen);
    }

    drawManipulators(ctx, scene, overlay, toScreen);
    drawOverlay(ctx, scene, viewport, overlay, toScreen);
    drawViewTitle(ctx, scene, viewport);

    ctx.restore();
}

function elementsOf<T>(scene: PlanScene, kind: string): T[] {
    if (scene.settings.hiddenCategories.includes(kind as never)) {
        return [];
    }

    return scene.document.elements.filter(
        (element) =>
            element.kind === kind &&
            element.level === scene.level &&
            !scene.hidden.has(element.id) &&
            phaseVisible(element, scene.settings.phaseFilter),
    ) as T[];
}

function tracePolygon(
    ctx: CanvasRenderingContext2D,
    points: Point[],
    toScreen: (p: Point) => Point,
): void {
    if (points.length === 0) {
        return;
    }

    const first = toScreen(points[0]);
    ctx.moveTo(first.x, first.y);

    for (let index = 1; index < points.length; index++) {
        const next = toScreen(points[index]);
        ctx.lineTo(next.x, next.y);
    }

    ctx.closePath();
}

function drawGrid(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    viewport: Viewport,
): void {
    const spacing = scene.units === 'imperial' ? 304.8 : 1000;
    const bounds = visibleBounds(viewport);
    const pixelsPerStep = spacing * viewport.camera.zoom;

    // Coarsen the grid rather than drawing a solid block of lines.
    let step = spacing;

    while (step * viewport.camera.zoom < 8) {
        step *= 5;
    }

    const majorEvery = 5;
    const startX = Math.floor(bounds.minX / step) * step;
    const startY = Math.floor(bounds.minY / step) * step;

    ctx.save();
    ctx.lineWidth = 1;

    for (let x = startX; x <= bounds.maxX; x += step) {
        const isMajor = Math.round(x / step) % majorEvery === 0;
        const screenX = worldToScreen({ x, y: 0 }, viewport).x;

        ctx.beginPath();
        ctx.strokeStyle = isMajor ? CAD_THEME.gridMajor : CAD_THEME.grid;
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, viewport.height);
        ctx.stroke();
    }

    for (let y = startY; y <= bounds.maxY; y += step) {
        const isMajor = Math.round(y / step) % majorEvery === 0;
        const screenY = worldToScreen({ x: 0, y }, viewport).y;

        ctx.beginPath();
        ctx.strokeStyle = isMajor ? CAD_THEME.gridMajor : CAD_THEME.grid;
        ctx.moveTo(0, screenY);
        ctx.lineTo(viewport.width, screenY);
        ctx.stroke();
    }

    if (pixelsPerStep > 0) {
        const origin = worldToScreen({ x: 0, y: 0 }, viewport);
        ctx.strokeStyle = CAD_THEME.sand;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(origin.x - 14, origin.y);
        ctx.lineTo(origin.x + 14, origin.y);
        ctx.moveTo(origin.x, origin.y - 14);
        ctx.lineTo(origin.x, origin.y + 14);
        ctx.stroke();
    }

    ctx.restore();
}

function drawUnderlay(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    if (!scene.settings.underlay || scene.underlay.length === 0) {
        return;
    }

    ctx.save();
    ctx.strokeStyle = CAD_THEME.inkFaint;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);

    scene.underlay.forEach((wall) => {
        ctx.beginPath();
        tracePolygon(ctx, wall.polygon, toScreen);
        ctx.stroke();
    });

    ctx.restore();
}

function drawFloors(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    const floors = elementsOf<FloorElement>(scene, 'floor');

    ctx.save();
    ctx.fillStyle = CAD_THEME.paperShade;
    ctx.strokeStyle = CAD_THEME.inkFaint;
    ctx.lineWidth = 0.8;

    floors.forEach((floor) => {
        ctx.beginPath();
        tracePolygon(ctx, floor.points, toScreen);
        ctx.fill();
        ctx.stroke();
    });

    ctx.restore();
}

function drawRoomFills(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();

    elementsOf<RoomElement>(scene, 'room').forEach((room) => {
        const boundary = scene.rooms.get(room.id);

        if (!boundary || boundary.polygon.length < 3) {
            return;
        }

        ctx.beginPath();
        tracePolygon(ctx, boundary.polygon, toScreen);
        ctx.fillStyle = scene.selection.has(room.id)
            ? CAD_THEME.selectionFill
            : CAD_THEME.roomFill;
        ctx.fill();
        ctx.strokeStyle = CAD_THEME.roomStroke;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    });

    ctx.restore();
}

/**
 * Wall bodies are filled first, then the openings are punched out, then the
 * face lines are stroked through a clip that excludes those openings so no
 * line ever crosses a doorway.
 *
 * How much of the compound structure shows depends on the detail level, the
 * way it does in Revit: Coarse is a single poched body, Medium adds the core
 * boundary, and Fine hatches the core between them.
 */
function drawWalls(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    viewport: Viewport,
    toScreen: (p: Point) => Point,
): void {
    const walls = [...scene.geometry.values()].filter(
        (wall) =>
            wall.wall.level === scene.level &&
            !scene.hidden.has(wall.wall.id) &&
            !scene.settings.hiddenCategories.includes('wall') &&
            phaseVisible(wall.wall, scene.settings.phaseFilter),
    );

    if (walls.length === 0) {
        return;
    }

    const detail = scene.settings.detailLevel;
    const openings = openingGeometries(scene);
    const curtains = walls.filter((wall) => wall.type.function === 'curtain');
    const solidWalls = walls.filter((wall) => wall.type.function !== 'curtain');

    ctx.save();

    solidWalls.forEach((wall) => {
        ctx.save();
        applyPhaseGraphics(ctx, wall.wall);
        ctx.beginPath();
        tracePolygon(ctx, wall.polygon, toScreen);

        if (wall.wall.phase !== 'demolished') {
            ctx.fillStyle =
                detail === 'coarse'
                    ? CAD_THEME.wallPoche
                    : wall.type.function === 'exterior'
                      ? CAD_THEME.wallFill
                      : CAD_THEME.wallFillInterior;
            ctx.fill();
        }

        ctx.restore();
    });

    if (detail === 'fine') {
        drawWallHatch(
            ctx,
            solidWalls.filter((wall) => wall.wall.phase !== 'demolished'),
            toScreen,
        );
    }

    // Punch the voids out of the filled bodies.
    openings.forEach((opening) => {
        ctx.beginPath();
        tracePolygon(ctx, opening.polygon, toScreen);
        ctx.fillStyle = CAD_THEME.paper;
        ctx.fill();
    });

    const clip = new Path2D();
    clip.rect(0, 0, viewport.width, viewport.height);

    openings.forEach((opening) => {
        const screenPoints = opening.polygon.map(toScreen);
        clip.moveTo(screenPoints[0].x, screenPoints[0].y);
        screenPoints.slice(1).forEach((p) => clip.lineTo(p.x, p.y));
        clip.closePath();
    });

    ctx.save();
    ctx.clip(clip, 'evenodd');

    if (detail !== 'coarse') {
        drawCoreBoundaries(ctx, solidWalls, toScreen);
    }

    solidWalls.forEach((wall) => {
        ctx.save();
        applyPhaseGraphics(ctx, wall.wall);
        ctx.beginPath();
        tracePolygon(ctx, wall.polygon, toScreen);
        ctx.strokeStyle =
            wall.type.function === 'exterior'
                ? CAD_THEME.wallExterior
                : CAD_THEME.wallInterior;
        ctx.lineWidth = wall.type.function === 'exterior' ? 1.7 : 1.15;
        ctx.stroke();
        ctx.restore();
    });

    ctx.restore();

    curtains.forEach((wall) => {
        drawCurtainWall(ctx, wall, toScreen);
    });

    ctx.restore();
}

/** Mullion spacing along a curtain wall, in millimetres. */
const CURTAIN_MODULE = 1200;

/**
 * A curtain wall in plan: glazing on the centre line with square mullion
 * ticks at every module, the way Revit draws storefront at medium detail.
 */
function drawCurtainWall(
    ctx: CanvasRenderingContext2D,
    wall: WallGeometry,
    toScreen: (p: Point) => Point,
): void {
    const from = toScreen(wall.a);
    const to = toScreen(wall.b);

    ctx.save();
    applyPhaseGraphics(ctx, wall.wall);

    ctx.beginPath();
    ctx.strokeStyle = CAD_THEME.glass;
    ctx.lineWidth = 2.2;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.fillStyle = CAD_THEME.wallExterior;

    const modules = Math.max(Math.round(wall.length / CURTAIN_MODULE), 1);

    for (let index = 0; index <= modules; index++) {
        const at = toScreen(lerp(wall.a, wall.b, index / modules));
        ctx.fillRect(at.x - 2.4, at.y - 2.4, 4.8, 4.8);
    }

    ctx.restore();
}

/**
 * The pair of lines separating the structural core from its finish layers.
 *
 * Both are interpolated between the two face points at each end of the wall,
 * so a mitred corner carries its join through to the core lines for free.
 */
function coreEdges(
    wall: WallGeometry,
): { left: [Point, Point]; right: [Point, Point] } | null {
    const { finish } = wallLayers(wall.type);

    if (finish <= 0) {
        return null;
    }

    const [aLeft, bLeft, bRight, aRight] = wall.polygon;
    const factor = finish / wall.thickness;

    return {
        left: [lerp(aLeft, aRight, factor), lerp(bLeft, bRight, factor)],
        right: [lerp(aRight, aLeft, factor), lerp(bRight, bLeft, factor)],
    };
}

function drawCoreBoundaries(
    ctx: CanvasRenderingContext2D,
    walls: WallGeometry[],
    toScreen: (p: Point) => Point,
): void {
    ctx.save();
    ctx.strokeStyle = CAD_THEME.wallInterior;
    ctx.lineWidth = 0.7;

    walls.forEach((wall) => {
        const edges = coreEdges(wall);

        if (!edges) {
            return;
        }

        ctx.beginPath();

        [edges.left, edges.right].forEach(([from, to]) => {
            const start = toScreen(from);
            const end = toScreen(to);
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
        });

        ctx.stroke();
    });

    ctx.restore();
}

/**
 * Diagonal hatch across the structural core, clipped to the core itself so it
 * never bleeds into the finish layers.
 */
function drawWallHatch(
    ctx: CanvasRenderingContext2D,
    walls: WallGeometry[],
    toScreen: (p: Point) => Point,
): void {
    const spacing = 6;

    ctx.save();
    ctx.strokeStyle = CAD_THEME.wallHatch;
    ctx.lineWidth = 0.6;

    walls.forEach((wall) => {
        const edges = coreEdges(wall);
        const region = edges
            ? [edges.left[0], edges.left[1], edges.right[1], edges.right[0]]
            : wall.polygon;

        ctx.save();
        ctx.beginPath();
        tracePolygon(ctx, region, toScreen);
        ctx.clip();

        const screenPoints = region.map(toScreen);
        const minX = Math.min(...screenPoints.map((p) => p.x));
        const maxX = Math.max(...screenPoints.map((p) => p.x));
        const minY = Math.min(...screenPoints.map((p) => p.y));
        const maxY = Math.max(...screenPoints.map((p) => p.y));
        const span = maxX - minX + (maxY - minY);

        ctx.beginPath();

        for (let offset = 0; offset <= span; offset += spacing) {
            ctx.moveTo(minX + offset, minY);
            ctx.lineTo(minX + offset - (maxY - minY), maxY);
        }

        ctx.stroke();
        ctx.restore();
    });

    ctx.restore();
}

function openingGeometries(scene: PlanScene) {
    return scene.document.elements
        .filter(
            (element): element is OpeningElement =>
                (element.kind === 'door' || element.kind === 'window') &&
                element.level === scene.level,
        )
        .map((opening) => {
            const host = scene.geometry.get(opening.host);

            return host
                ? buildOpeningGeometry(scene.document, opening, host)
                : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
}

function drawOpenings(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    const detail = scene.settings.detailLevel;

    ctx.save();
    ctx.lineJoin = 'miter';

    openingGeometries(scene).forEach((geometry) => {
        const { opening, host } = geometry;
        const reach = scale(host.normal, host.thickness / 2);
        const selected = scene.selection.has(opening.id);

        ctx.strokeStyle = selected
            ? CAD_THEME.selection
            : CAD_THEME.wallExterior;
        ctx.lineWidth = selected ? 2 : 1.2;

        // Jamb lines close the wall body at both sides of the opening.
        [geometry.jambA, geometry.jambB].forEach((jamb) => {
            const from = toScreen(add(jamb, reach));
            const to = toScreen(subtract(jamb, reach));

            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
        });

        if (opening.kind === 'window') {
            drawWindowLeaf(ctx, scene, geometry, detail, toScreen);

            return;
        }

        drawDoorLeaf(ctx, scene, geometry, detail, toScreen);
    });

    ctx.restore();
}

/**
 * Window in plan.
 *
 * Coarse shows the glazing as a single line, Medium adds the frame at both
 * faces, and Fine splits the glazing into a double line and projects a sill
 * past the outer face.
 */
function drawWindowLeaf(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    geometry: ReturnType<typeof openingGeometries>[number],
    detail: DetailLevel,
    toScreen: (p: Point) => Point,
): void {
    const { host, opening } = geometry;
    const stroke = (
        factor: number,
        style: string,
        width: number,
        overshoot = 0,
    ) => {
        const offset = scale(host.normal, host.thickness * factor);
        const along = scale(host.direction, overshoot);
        const from = toScreen(add(subtract(geometry.jambA, along), offset));
        const to = toScreen(add(add(geometry.jambB, along), offset));

        ctx.beginPath();
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
    };

    ctx.save();

    if (detail === 'coarse') {
        stroke(0, CAD_THEME.glass, 1.1);
        ctx.restore();

        return;
    }

    // Frame at both wall faces.
    stroke(0.5, CAD_THEME.wallExterior, 1.2);
    stroke(-0.5, CAD_THEME.wallExterior, 1.2);

    if (detail === 'medium') {
        stroke(0, CAD_THEME.glass, 1.1);
        ctx.restore();

        return;
    }

    // Fine: double glazing plus a projecting sill on the outer face.
    stroke(0.09, CAD_THEME.glass, 1);
    stroke(-0.09, CAD_THEME.glass, 1);

    const type = windowTypeOf(scene.document, opening.typeId);
    const sillSide = opening.flipFace ? -1 : 1;
    const sillFactor = sillSide * (0.5 + 45 / Math.max(host.thickness, 1));

    stroke(sillFactor, CAD_THEME.sill, 0.9, 55);
    void type;

    ctx.restore();
}

/**
 * Door in plan.
 *
 * Coarse leaves the opening empty, Medium draws the leaf and its swing, and
 * Fine thickens the leaf into a panel and adds a threshold across the opening.
 */
function drawDoorLeaf(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    geometry: ReturnType<typeof openingGeometries>[number],
    detail: DetailLevel,
    toScreen: (p: Point) => Point,
): void {
    const { opening, host, width } = geometry;

    // A reflected ceiling plan shows the opening but never the swing.
    if (scene.reflected || detail === 'coarse') {
        return;
    }

    const type = doorTypeOf(scene.document, opening.typeId);
    const swingSide = opening.flipFace ? -1 : 1;
    const hingeAtA = !opening.flipHand;
    const leaves = Math.max(type.leaves, 1);
    const leafWidth = width / leaves;
    const selected = scene.selection.has(opening.id);
    const leafColour = selected ? CAD_THEME.selection : CAD_THEME.ink;

    ctx.save();

    if (detail === 'fine') {
        // Threshold line across the opening, on the swing side of the wall.
        const threshold = scale(host.normal, (swingSide * host.thickness) / 2);
        const from = toScreen(add(geometry.jambA, threshold));
        const to = toScreen(add(geometry.jambB, threshold));

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.inkFaint;
        ctx.lineWidth = 0.8;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
    }

    for (let index = 0; index < leaves; index++) {
        const fromA = leaves === 1 ? hingeAtA : index === 0;
        const hinge = fromA
            ? add(geometry.jambA, scale(host.direction, index * leafWidth))
            : subtract(
                  geometry.jambB,
                  scale(host.direction, index * leafWidth),
              );
        const along = scale(host.direction, fromA ? leafWidth : -leafWidth);
        const swing = scale(host.normal, swingSide * leafWidth);

        const hingeScreen = toScreen(hinge);
        const openLeaf = toScreen(add(hinge, swing));
        const closed = add(hinge, along);

        ctx.strokeStyle = leafColour;
        ctx.lineWidth = selected ? 2 : 1.2;

        if (detail === 'fine') {
            // Leaf as a panel of real thickness rather than a bare line.
            const panel = scale(host.direction, fromA ? DOOR_LEAF : -DOOR_LEAF);
            const tip = add(hinge, swing);

            ctx.beginPath();
            tracePolygon(
                ctx,
                [hinge, tip, add(tip, panel), add(hinge, panel)],
                toScreen,
            );
            ctx.fillStyle = selected
                ? CAD_THEME.selectionFill
                : CAD_THEME.wallFill;
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.moveTo(hingeScreen.x, hingeScreen.y);
            ctx.lineTo(openLeaf.x, openLeaf.y);
            ctx.stroke();
        }

        // Swing arc from the open leaf back to the closed position.
        const radius = distance(hingeScreen, openLeaf);
        const startAngle = Math.atan2(
            openLeaf.y - hingeScreen.y,
            openLeaf.x - hingeScreen.x,
        );
        const closedScreen = toScreen(closed);
        const endAngle = Math.atan2(
            closedScreen.y - hingeScreen.y,
            closedScreen.x - hingeScreen.x,
        );

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.inkSoft;
        ctx.lineWidth = 0.8;
        ctx.arc(
            hingeScreen.x,
            hingeScreen.y,
            radius,
            startAngle,
            endAngle,
            swingSide > 0,
        );
        ctx.stroke();
    }

    ctx.restore();
}

function drawColumns(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();

    elementsOf<ColumnElement>(scene, 'column').forEach((column) => {
        const half = column.size / 2;
        const corners: Point[] = [
            { x: -half, y: -half },
            { x: half, y: -half },
            { x: half, y: half },
            { x: -half, y: half },
        ].map((corner) => {
            const cos = Math.cos(column.rotation);
            const sin = Math.sin(column.rotation);

            return {
                x: column.p.x + corner.x * cos - corner.y * sin,
                y: column.p.y + corner.x * sin + corner.y * cos,
            };
        });

        ctx.beginPath();
        tracePolygon(ctx, corners, toScreen);
        ctx.fillStyle = CAD_THEME.wallFill;
        ctx.fill();
        ctx.strokeStyle = scene.selection.has(column.id)
            ? CAD_THEME.selection
            : CAD_THEME.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Structural columns carry a cross in plan.
        const a = toScreen(corners[0]);
        const c = toScreen(corners[2]);
        const b = toScreen(corners[1]);
        const d = toScreen(corners[3]);

        ctx.beginPath();
        ctx.lineWidth = 0.7;
        ctx.strokeStyle = CAD_THEME.inkSoft;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
    });

    ctx.restore();
}

/**
 * Imported geometry has no plan symbol of its own, so it is shown as the
 * convex hull of its footprint with the file name against it.
 */
function drawMeshes(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    const meshes = elementsOf<MeshElement>(scene, 'mesh');

    if (meshes.length === 0) {
        return;
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    meshes.forEach((mesh) => {
        const selected = scene.selection.has(mesh.id);
        const footprint = placedFootprint(mesh);

        if (footprint.length >= 3) {
            ctx.beginPath();
            tracePolygon(ctx, footprint, toScreen);
            ctx.fillStyle = selected
                ? CAD_THEME.selectionFill
                : 'rgba(194, 171, 146, 0.18)';
            ctx.fill();
            ctx.setLineDash([6, 3]);
            ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.sand;
            ctx.lineWidth = selected ? 2 : 1.1;
            ctx.stroke();
            ctx.setLineDash([]);
        }

        if (scene.settings.showTags) {
            const origin = toScreen(mesh.p);
            ctx.font = '500 11px Karla, ui-sans-serif, sans-serif';
            ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
            ctx.fillText(mesh.name, origin.x, origin.y);
        }
    });

    ctx.restore();
}

/** Footprint transformed by the mesh's own placement. */
export function placedFootprint(mesh: MeshElement): Point[] {
    const cos = Math.cos(mesh.rotation);
    const sin = Math.sin(mesh.rotation);

    return mesh.footprint.map((corner) => {
        const x = corner.x * mesh.scale;
        const y = corner.y * mesh.scale;

        return {
            x: mesh.p.x + x * cos - y * sin,
            y: mesh.p.y + x * sin + y * cos,
        };
    });
}

function drawDetailLines(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();

    elementsOf<LineElement>(scene, 'line').forEach((line) => {
        const a = toScreen(line.a);
        const b = toScreen(line.b);

        ctx.beginPath();
        ctx.strokeStyle = scene.selection.has(line.id)
            ? CAD_THEME.selection
            : CAD_THEME.inkSoft;
        ctx.lineWidth = scene.selection.has(line.id) ? 2 : 1;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    });

    ctx.restore();
}

/**
 * Aligned dimensions, drawn the way Revit's default style does: witness lines
 * that hold a small gap off what they measure and overshoot the dimension line,
 * diagonal ticks rather than arrowheads, and the value sitting on the line.
 *
 * The gap and overshoot are paper-space constants, so they hold their size as
 * the view is zoomed.
 */
function drawDimensions(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();
    ctx.font = '500 11px Karla, ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    elementsOf<DimensionElement>(scene, 'dimension').forEach((dimension) => {
        const direction = normalize(subtract(dimension.b, dimension.a));

        if (direction.x === 0 && direction.y === 0) {
            return;
        }

        const normal = perpendicular(direction);
        const shift = scale(normal, dimension.offset);
        const selected = scene.selection.has(dimension.id);

        const screenFrom = toScreen(add(dimension.a, shift));
        const screenTo = toScreen(add(dimension.b, shift));

        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.dimension;
        ctx.lineWidth = selected ? 1.6 : 0.9;

        ctx.beginPath();
        ctx.moveTo(screenFrom.x, screenFrom.y);
        ctx.lineTo(screenTo.x, screenTo.y);

        // Witness lines, offset off the reference and run past the dimension.
        (
            [
                [toScreen(dimension.a), screenFrom],
                [toScreen(dimension.b), screenTo],
            ] as const
        ).forEach(([reference, onLine]) => {
            const span = subtract(onLine, reference);
            const length = Math.hypot(span.x, span.y);

            if (length < WITNESS_GAP + 1) {
                return;
            }

            const unit = { x: span.x / length, y: span.y / length };

            ctx.moveTo(
                reference.x + unit.x * WITNESS_GAP,
                reference.y + unit.y * WITNESS_GAP,
            );
            ctx.lineTo(
                onLine.x + unit.x * WITNESS_EXTENSION,
                onLine.y + unit.y * WITNESS_EXTENSION,
            );
        });

        ctx.stroke();

        // Architectural tick marks rather than arrowheads.
        const angle = Math.atan2(
            screenTo.y - screenFrom.y,
            screenTo.x - screenFrom.x,
        );

        [screenFrom, screenTo].forEach((anchor) => {
            const dx = Math.cos(angle + Math.PI / 4) * 5;
            const dy = Math.sin(angle + Math.PI / 4) * 5;

            ctx.beginPath();
            ctx.moveTo(anchor.x - dx, anchor.y - dy);
            ctx.lineTo(anchor.x + dx, anchor.y + dy);
            ctx.stroke();
        });

        drawDimensionText(
            ctx,
            formatDimension(distance(dimension.a, dimension.b), scene.units),
            screenFrom,
            screenTo,
            selected ? CAD_THEME.selection : CAD_THEME.dimension,
            CAD_THEME.paper,
        );
    });

    ctx.restore();
}

/**
 * Draw a dimension value centred on its line, flipped so it always reads
 * left to right, over a knocked-out background.
 */
function drawDimensionText(
    ctx: CanvasRenderingContext2D,
    label: string,
    from: Point,
    to: Point,
    colour: string,
    background: string,
): void {
    const centre = midpoint(from, to);
    let rotation = angleOf(subtract(to, from));

    if (rotation > Math.PI / 2 || rotation < -Math.PI / 2) {
        rotation += Math.PI;
    }

    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.rotate(rotation);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const metrics = ctx.measureText(label);
    ctx.fillStyle = background;
    ctx.fillRect(-metrics.width / 2 - 3, -14, metrics.width + 6, 14);
    ctx.fillStyle = colour;
    ctx.fillText(label, 0, -3);
    ctx.restore();
}

function drawRoomTags(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();
    ctx.textAlign = 'center';

    elementsOf<RoomElement>(scene, 'room').forEach((room) => {
        const boundary = scene.rooms.get(room.id);
        const anchor = boundary?.polygon.length
            ? polygonCentroid(boundary.polygon)
            : room.p;
        const origin = toScreen(anchor);
        const selected = scene.selection.has(room.id);

        ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.ink;
        ctx.font = '600 13px Karla, ui-sans-serif, sans-serif';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(room.name, origin.x, origin.y - 4);

        ctx.font = '400 11px Karla, ui-sans-serif, sans-serif';
        ctx.fillStyle = CAD_THEME.inkSoft;
        ctx.fillText(
            boundary ? formatArea(boundary.area, scene.units) : 'Not Enclosed',
            origin.x,
            origin.y + 11,
        );
        ctx.fillText(room.number, origin.x, origin.y + 24);
    });

    ctx.restore();
}

function drawTextNotes(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    elementsOf<TextElement>(scene, 'text').forEach((note) => {
        const origin = toScreen(note.p);

        ctx.font = `400 ${Math.max(note.size / 10, 9)}px Karla, ui-sans-serif, sans-serif`;
        ctx.fillStyle = scene.selection.has(note.id)
            ? CAD_THEME.selection
            : CAD_THEME.text;
        ctx.fillText(note.value, origin.x, origin.y);
    });

    ctx.restore();
}

function drawHighlights(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();

    scene.geometry.forEach((wall) => {
        if (wall.wall.level !== scene.level) {
            return;
        }

        const selected = scene.selection.has(wall.wall.id);
        const hovered = scene.hovered === wall.wall.id;

        if (!selected && !hovered) {
            return;
        }

        ctx.beginPath();
        tracePolygon(ctx, wall.polygon, toScreen);
        ctx.fillStyle = selected
            ? CAD_THEME.selectionFill
            : CAD_THEME.highlightFill;
        ctx.fill();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.highlight;
        ctx.lineWidth = selected ? 2.2 : 1.6;
        ctx.stroke();
    });

    ctx.restore();
}

function drawOverlay(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    viewport: Viewport,
    overlay: PlanOverlay,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();

    overlay.previewWalls?.forEach((preview) => {
        const direction = normalize(subtract(preview.b, preview.a));

        if (direction.x === 0 && direction.y === 0) {
            return;
        }

        const normal = scale(perpendicular(direction), preview.thickness / 2);
        const polygon = [
            add(preview.a, normal),
            add(preview.b, normal),
            subtract(preview.b, normal),
            subtract(preview.a, normal),
        ];

        ctx.beginPath();
        tracePolygon(ctx, polygon, toScreen);
        ctx.fillStyle = CAD_THEME.highlightFill;
        ctx.fill();
        ctx.strokeStyle = CAD_THEME.highlight;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        drawLengthTag(ctx, preview.a, preview.b, scene.units, toScreen);
    });

    if (overlay.previewPolygon && overlay.previewPolygon.length >= 2) {
        ctx.beginPath();
        tracePolygon(ctx, overlay.previewPolygon, toScreen);
        ctx.fillStyle = CAD_THEME.highlightFill;
        ctx.fill();
        ctx.strokeStyle = CAD_THEME.highlight;
        ctx.lineWidth = 1.4;
        ctx.stroke();
    }

    if (overlay.previewPath && overlay.previewPath.length >= 2) {
        const screen = overlay.previewPath.map(toScreen);

        ctx.beginPath();
        ctx.setLineDash([8, 5]);
        ctx.strokeStyle = CAD_THEME.highlight;
        ctx.lineWidth = 1.4;
        ctx.moveTo(screen[0].x, screen[0].y);
        screen.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (overlay.previewOpening) {
        const { center, direction, normal, width, thickness, kind } =
            overlay.previewOpening;
        const half = scale(direction, width / 2);
        const reach = scale(normal, thickness / 2);
        const polygon = [
            add(subtract(center, half), reach),
            add(add(center, half), reach),
            subtract(add(center, half), reach),
            subtract(subtract(center, half), reach),
        ];

        ctx.beginPath();
        tracePolygon(ctx, polygon, toScreen);
        ctx.fillStyle =
            kind === 'door'
                ? CAD_THEME.highlightFill
                : 'rgba(143, 182, 196, 0.3)';
        ctx.fill();
        ctx.strokeStyle = CAD_THEME.highlight;
        ctx.lineWidth = 1.4;
        ctx.stroke();
    }

    if (overlay.rubberBand) {
        const a = toScreen(overlay.rubberBand.a);
        const b = toScreen(overlay.rubberBand.b);

        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = CAD_THEME.highlight;
        ctx.lineWidth = 1.2;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (overlay.axis) {
        const a = toScreen(overlay.axis.a);
        const b = toScreen(overlay.axis.b);

        ctx.beginPath();
        ctx.setLineDash([10, 6]);
        ctx.strokeStyle = CAD_THEME.sand;
        ctx.lineWidth = 1;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (overlay.measure) {
        drawLengthTag(
            ctx,
            overlay.measure.a,
            overlay.measure.b,
            scene.units,
            toScreen,
        );

        const a = toScreen(overlay.measure.a);
        const b = toScreen(overlay.measure.b);

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.dimension;
        ctx.lineWidth = 1.4;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }

    if (overlay.selectionRect) {
        const a = toScreen(overlay.selectionRect.a);
        const b = toScreen(overlay.selectionRect.b);
        const crossing = overlay.selectionRect.crossing;

        ctx.beginPath();
        ctx.rect(
            Math.min(a.x, b.x),
            Math.min(a.y, b.y),
            Math.abs(b.x - a.x),
            Math.abs(b.y - a.y),
        );
        ctx.fillStyle = crossing
            ? 'rgba(246, 139, 33, 0.12)'
            : 'rgba(15, 127, 190, 0.12)';
        ctx.fill();
        ctx.setLineDash(crossing ? [6, 4] : []);
        ctx.strokeStyle = crossing ? CAD_THEME.highlight : CAD_THEME.selection;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (overlay.snap && overlay.snap.kind !== 'free') {
        drawSnapMarker(ctx, overlay.snap, toScreen);
    }

    ctx.restore();
    void viewport;
}

function drawLengthTag(
    ctx: CanvasRenderingContext2D,
    a: Point,
    b: Point,
    units: Units,
    toScreen: (p: Point) => Point,
): void {
    const label = formatDimension(distance(a, b), units);

    if (label === '0') {
        return;
    }

    const centre = midpoint(toScreen(a), toScreen(b));

    ctx.save();
    ctx.font = '600 12px Karla, ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(label);
    ctx.fillStyle = CAD_THEME.ink;
    ctx.fillRect(
        centre.x - metrics.width / 2 - 5,
        centre.y - 10,
        metrics.width + 10,
        19,
    );
    ctx.fillStyle = CAD_THEME.paper;
    ctx.fillText(label, centre.x, centre.y);
    ctx.restore();
}

function drawSnapMarker(
    ctx: CanvasRenderingContext2D,
    snap: SnapResult,
    toScreen: (p: Point) => Point,
): void {
    const p = toScreen(snap.point);
    const size = 5;

    ctx.save();
    ctx.strokeStyle = CAD_THEME.snap;
    ctx.fillStyle = 'rgba(15, 127, 190, 0.2)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();

    switch (snap.kind) {
        case 'endpoint':
            ctx.rect(p.x - size, p.y - size, size * 2, size * 2);
            break;
        case 'midpoint':
            ctx.moveTo(p.x, p.y - size);
            ctx.lineTo(p.x + size, p.y + size);
            ctx.lineTo(p.x - size, p.y + size);
            ctx.closePath();
            break;
        case 'intersection':
            ctx.moveTo(p.x - size, p.y - size);
            ctx.lineTo(p.x + size, p.y + size);
            ctx.moveTo(p.x + size, p.y - size);
            ctx.lineTo(p.x - size, p.y + size);
            break;
        case 'perpendicular':
            ctx.moveTo(p.x - size, p.y - size);
            ctx.lineTo(p.x - size, p.y + size);
            ctx.lineTo(p.x + size, p.y + size);
            break;
        case 'grid':
            ctx.arc(p.x, p.y, size * 0.7, 0, Math.PI * 2);
            break;
        default:
            ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
            break;
    }

    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

/* ------------------------------------------------------ datum & view frame */

/**
 * Bounding box of everything the level draws, used to place the crop region
 * and the elevation markers that ring the building.
 */
function contentBounds(scene: PlanScene): CropRegion | null {
    const points: Point[] = [];

    scene.geometry.forEach((wall) => {
        if (wall.wall.level === scene.level) {
            points.push(...wall.polygon);
        }
    });

    elementsOf<FloorElement>(scene, 'floor').forEach((floor) =>
        points.push(...floor.points),
    );
    elementsOf<ColumnElement>(scene, 'column').forEach((column) =>
        points.push(column.p),
    );

    if (points.length === 0) {
        return null;
    }

    return points.reduce<CropRegion>(
        (bounds, item) => ({
            minX: Math.min(bounds.minX, item.x),
            minY: Math.min(bounds.minY, item.y),
            maxX: Math.max(bounds.maxX, item.x),
            maxY: Math.max(bounds.maxY, item.y),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
}

/** Margin held between the building and the crop boundary, in millimetres. */
const CROP_MARGIN = 2500;

export function cropRectangle(scene: PlanScene): CropRegion | null {
    if (scene.settings.crop) {
        return scene.settings.crop;
    }

    const bounds = contentBounds(scene);

    if (!bounds) {
        return null;
    }

    return {
        minX: bounds.minX - CROP_MARGIN,
        minY: bounds.minY - CROP_MARGIN,
        maxX: bounds.maxX + CROP_MARGIN,
        maxY: bounds.maxY + CROP_MARGIN,
    };
}

function drawCropBoundary(
    ctx: CanvasRenderingContext2D,
    crop: CropRegion,
    toScreen: (p: Point) => Point,
): void {
    const topLeft = toScreen({ x: crop.minX, y: crop.maxY });
    const bottomRight = toScreen({ x: crop.maxX, y: crop.minY });

    ctx.save();
    ctx.strokeStyle = CAD_THEME.cropRegion;
    ctx.lineWidth = 1;
    ctx.setLineDash([9, 5]);
    ctx.strokeRect(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y,
    );
    ctx.restore();
}

/**
 * Elements taken out of the view, drawn back in outline so Reveal Hidden
 * Elements shows what is being suppressed.
 */
function drawRevealedHidden(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    if (scene.hidden.size === 0) {
        return;
    }

    ctx.save();
    ctx.strokeStyle = CAD_THEME.ember;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.75;

    scene.geometry.forEach((wall) => {
        if (wall.wall.level !== scene.level) {
            return;
        }

        if (!scene.hidden.has(wall.wall.id)) {
            return;
        }

        ctx.beginPath();
        tracePolygon(ctx, wall.polygon, toScreen);
        ctx.stroke();
    });

    ctx.restore();
}

/** Screen radius of an elevation marker bubble. */
const ELEVATION_MARKER_RADIUS = 13;

/**
 * The four elevation markers Revit rings a plan with, each a bubble with a
 * filled pointer aimed at the building.
 */
function drawElevationMarkers(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    const bounds = contentBounds(scene);

    if (!bounds) {
        return;
    }

    const centreX = (bounds.minX + bounds.maxX) / 2;
    const centreY = (bounds.minY + bounds.maxY) / 2;
    const gap = 3800;

    const markers: { anchor: Point; towards: number; label: string }[] = [
        {
            anchor: { x: centreX, y: bounds.maxY + gap },
            towards: -Math.PI / 2,
            label: 'N',
        },
        {
            anchor: { x: centreX, y: bounds.minY - gap },
            towards: Math.PI / 2,
            label: 'S',
        },
        {
            anchor: { x: bounds.maxX + gap, y: centreY },
            towards: Math.PI,
            label: 'E',
        },
        {
            anchor: { x: bounds.minX - gap, y: centreY },
            towards: 0,
            label: 'W',
        },
    ];

    ctx.save();
    ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    markers.forEach((marker) => {
        const origin = toScreen(marker.anchor);
        // Screen y grows downwards, so the world-space aim flips.
        const aim = -marker.towards;
        const tip = ELEVATION_MARKER_RADIUS + 7;
        const spread = 0.42;

        ctx.beginPath();
        ctx.arc(origin.x, origin.y, ELEVATION_MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = CAD_THEME.paper;
        ctx.fill();
        ctx.strokeStyle = CAD_THEME.datum;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Filled pointer showing which way the elevation looks.
        ctx.beginPath();
        ctx.moveTo(
            origin.x + Math.cos(aim) * tip,
            origin.y + Math.sin(aim) * tip,
        );
        ctx.lineTo(
            origin.x + Math.cos(aim - spread) * ELEVATION_MARKER_RADIUS,
            origin.y + Math.sin(aim - spread) * ELEVATION_MARKER_RADIUS,
        );
        ctx.lineTo(
            origin.x + Math.cos(aim + spread) * ELEVATION_MARKER_RADIUS,
            origin.y + Math.sin(aim + spread) * ELEVATION_MARKER_RADIUS,
        );
        ctx.closePath();
        ctx.fillStyle = CAD_THEME.datum;
        ctx.fill();
        ctx.fillText(marker.label, origin.x, origin.y + 0.5);
    });

    ctx.restore();
}

/**
 * View title block, the way Revit labels a view: the name over a rule, with
 * the scale beneath it.
 */
function drawViewTitle(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    viewport: Viewport,
): void {
    const left = 18;
    const baseline = viewport.height - 26;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = '600 15px Karla, ui-sans-serif, sans-serif';
    ctx.fillStyle = CAD_THEME.ink;
    ctx.fillText(scene.viewName, left, baseline);

    const width = Math.max(ctx.measureText(scene.viewName).width, 90);

    ctx.beginPath();
    ctx.strokeStyle = CAD_THEME.ink;
    ctx.lineWidth = 1.4;
    ctx.moveTo(left, baseline + 5);
    ctx.lineTo(left + width + 26, baseline + 5);
    ctx.stroke();

    ctx.font = '400 11px Karla, ui-sans-serif, sans-serif';
    ctx.fillStyle = CAD_THEME.inkSoft;
    ctx.fillText(formatScale(scene.settings.scale), left, baseline + 18);

    ctx.restore();
}

/* ----------------------------------------------------------- manipulators */

/** Stable identity for a grip, used to mark the one being dragged. */
export function gripKey(grip: Grip): string {
    switch (grip.kind) {
        case 'wallEnd':
        case 'lineEnd':
        case 'openingJamb':
            return `${grip.elementId}:${grip.kind}:${grip.end}`;
        case 'floorVertex':
            return `${grip.elementId}:floorVertex:${grip.index}`;
        default:
            return `${grip.elementId}:${grip.kind}`;
    }
}

/**
 * The blue controls Revit puts on a selection: temporary dimensions, flip
 * arrows and drag grips. All are drawn at a fixed size on paper.
 */
function drawManipulators(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    overlay: PlanOverlay,
    toScreen: (p: Point) => Point,
): void {
    const manipulators = overlay.manipulators;

    if (!manipulators) {
        return;
    }

    manipulators.temporaryDimensions.forEach((dimension) =>
        drawTemporaryDimension(ctx, scene, dimension, toScreen),
    );

    manipulators.flips.forEach((flip) => drawFlipControl(ctx, flip, toScreen));

    manipulators.grips.forEach((grip) => {
        const p = toScreen(grip.point);
        const active = overlay.activeGrip === gripKey(grip);

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, GRIP_RADIUS + (active ? 1.5 : 0), 0, Math.PI * 2);
        ctx.fillStyle = active ? CAD_THEME.grip : CAD_THEME.gripFill;
        ctx.fill();
        ctx.strokeStyle = CAD_THEME.grip;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
    });
}

function drawTemporaryDimension(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    dimension: TemporaryDimension,
    toScreen: (p: Point) => Point,
): void {
    const direction = normalize(subtract(dimension.b, dimension.a));

    if (direction.x === 0 && direction.y === 0) {
        return;
    }

    const shift = scale(perpendicular(direction), dimension.offset);
    const from = toScreen(add(dimension.a, shift));
    const to = toScreen(add(dimension.b, shift));

    ctx.save();
    ctx.strokeStyle = CAD_THEME.temporary;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);

    [
        [toScreen(dimension.a), from],
        [toScreen(dimension.b), to],
    ].forEach(([reference, onLine]) => {
        ctx.moveTo(reference.x, reference.y);
        ctx.lineTo(onLine.x, onLine.y);
    });

    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '600 11px Karla, ui-sans-serif, sans-serif';
    drawDimensionText(
        ctx,
        formatDimension(dimension.value, scene.units),
        from,
        to,
        CAD_THEME.paper,
        CAD_THEME.temporary,
    );

    ctx.restore();
}

function drawFlipControl(
    ctx: CanvasRenderingContext2D,
    flip: FlipControl,
    toScreen: (p: Point) => Point,
): void {
    const origin = toScreen(flip.anchor);
    const towards = toScreen(add(flip.anchor, flip.direction));
    const span = subtract(towards, origin);
    const length = Math.hypot(span.x, span.y);

    if (length < 1e-6) {
        return;
    }

    const unit = { x: span.x / length, y: span.y / length };
    const normal = { x: -unit.y, y: unit.x };
    const reach = FLIP_OFFSET;
    // The hand control sits off to one side so the two never overlap.
    const lateral = flip.axis === 'face' ? 0 : 14;
    const base = {
        x: origin.x + normal.x * lateral,
        y: origin.y + normal.y * lateral,
    };

    ctx.save();
    ctx.strokeStyle = CAD_THEME.temporary;
    ctx.fillStyle = CAD_THEME.temporary;
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.moveTo(base.x - unit.x * reach, base.y - unit.y * reach);
    ctx.lineTo(base.x + unit.x * reach, base.y + unit.y * reach);
    ctx.stroke();

    [1, -1].forEach((sign) => {
        const tip = {
            x: base.x + unit.x * reach * sign,
            y: base.y + unit.y * reach * sign,
        };
        const back = 6;
        const spread = 3.6;

        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(
            tip.x - unit.x * back * sign + normal.x * spread,
            tip.y - unit.y * back * sign + normal.y * spread,
        );
        ctx.lineTo(
            tip.x - unit.x * back * sign - normal.x * spread,
            tip.y - unit.y * back * sign - normal.y * spread,
        );
        ctx.closePath();
        ctx.fill();
    });

    ctx.restore();
}

/**
 * Screen-space position of every flip control, so the canvas can pick one.
 */
export function flipControlAnchor(
    flip: FlipControl,
    toScreen: (p: Point) => Point,
): Point {
    const origin = toScreen(flip.anchor);
    const towards = toScreen(add(flip.anchor, flip.direction));
    const span = subtract(towards, origin);
    const length = Math.hypot(span.x, span.y);

    if (length < 1e-6) {
        return origin;
    }

    const normal = { x: -span.y / length, y: span.x / length };
    const lateral = flip.axis === 'face' ? 0 : 14;

    return {
        x: origin.x + normal.x * lateral,
        y: origin.y + normal.y * lateral,
    };
}

/* ------------------------------------------- roofs, ceilings, stairs, datum */

/**
 * Roofs in plan: the eave line solid, the sketch dashed, and the ridge drawn
 * so the plan reads the same way Revit's coarse roof plan does.
 */
function drawRoofs(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<RoofElement>(scene, 'roof').forEach((roof) => {
        if (roof.points.length < 3) {
            return;
        }

        const selected = scene.selection.has(roof.id);
        const eave = expandFootprint(roof.points, roof.overhang);

        ctx.save();

        ctx.beginPath();
        tracePolygon(ctx, eave, toScreen);
        ctx.fillStyle = selected
            ? CAD_THEME.selectionFill
            : 'rgba(168, 155, 140, 0.14)';
        ctx.fill();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        ctx.lineWidth = selected ? 2 : 1.2;
        ctx.stroke();

        // The sketch itself, dashed inside the eave.
        ctx.beginPath();
        tracePolygon(ctx, roof.points, toScreen);
        ctx.setLineDash([7, 4]);
        ctx.strokeStyle = CAD_THEME.inkFaint;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.setLineDash([]);

        const ridge = roofRidge(eave, roof.slope);

        ctx.beginPath();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        ctx.lineWidth = 1.1;

        if (ridge.points.length === 2) {
            const [ridgeA, ridgeB] = ridge.points;
            const a = toScreen(ridgeA);
            const b = toScreen(ridgeB);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);

            // Hip lines from each eave corner to the nearer ridge end.
            eave.forEach((corner) => {
                const screenCorner = toScreen(corner);
                const nearer =
                    Math.hypot(corner.x - ridgeA.x, corner.y - ridgeA.y) <=
                    Math.hypot(corner.x - ridgeB.x, corner.y - ridgeB.y)
                        ? a
                        : b;
                ctx.moveTo(screenCorner.x, screenCorner.y);
                ctx.lineTo(nearer.x, nearer.y);
            });
        } else {
            const peak = toScreen(ridge.points[0]);

            eave.forEach((corner) => {
                const screenCorner = toScreen(corner);
                ctx.moveTo(screenCorner.x, screenCorner.y);
                ctx.lineTo(peak.x, peak.y);
            });
        }

        ctx.stroke();
        ctx.restore();
    });
}

/**
 * Ceilings only appear in reflected ceiling plans, hatched with the 600mm
 * tile grid Revit's compound ceilings show.
 */
function drawCeilings(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    if (!scene.reflected) {
        return;
    }

    elementsOf<CeilingElement>(scene, 'ceiling').forEach((ceiling) => {
        if (ceiling.points.length < 3) {
            return;
        }

        const selected = scene.selection.has(ceiling.id);

        ctx.save();
        ctx.beginPath();
        tracePolygon(ctx, ceiling.points, toScreen);
        ctx.fillStyle = selected
            ? CAD_THEME.selectionFill
            : 'rgba(194, 171, 146, 0.1)';
        ctx.fill();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.stroke();
        ctx.clip();

        // 600 mm tile grid in both directions.
        const xs = ceiling.points.map((p) => p.x);
        const ys = ceiling.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.inkFaint;
        ctx.lineWidth = 0.5;

        for (let x = Math.ceil(minX / 600) * 600; x <= maxX; x += 600) {
            const from = toScreen({ x, y: minY });
            const to = toScreen({ x, y: maxY });
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
        }

        for (let y = Math.ceil(minY / 600) * 600; y <= maxY; y += 600) {
            const from = toScreen({ x: minX, y });
            const to = toScreen({ x: maxX, y });
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
        }

        ctx.stroke();
        ctx.restore();
    });
}

/**
 * Stairs in plan: outline, treads, a centre line with the up arrow, and the
 * UP label at the base — Revit's standard stair symbol.
 */
function drawStairs(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<StairElement>(scene, 'stair').forEach((stair) => {
        const run = distance(stair.a, stair.b);

        if (run < 100) {
            return;
        }

        const selected = scene.selection.has(stair.id);
        const along = normalize(subtract(stair.b, stair.a));
        const side = scale(perpendicular(along), stair.width / 2);
        const { count, going } = stairSteps(stair);

        ctx.save();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.ink;
        ctx.lineWidth = selected ? 2 : 1.1;

        // Outline.
        ctx.beginPath();
        tracePolygon(
            ctx,
            [
                add(stair.a, side),
                add(stair.b, side),
                subtract(stair.b, side),
                subtract(stair.a, side),
            ],
            toScreen,
        );
        ctx.stroke();

        // Treads.
        ctx.beginPath();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;

        for (let index = 1; index < count; index++) {
            const at = add(stair.a, scale(along, going * index));
            const from = toScreen(add(at, side));
            const to = toScreen(subtract(at, side));
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
        }

        ctx.stroke();

        // Centre line with the direction arrow.
        const start = toScreen(stair.a);
        const end = toScreen(stair.b);

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.ink;
        ctx.lineWidth = 1;
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        const angle = Math.atan2(end.y - start.y, end.x - start.x);

        ctx.beginPath();
        ctx.fillStyle = CAD_THEME.ink;
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
            end.x - Math.cos(angle - 0.42) * 11,
            end.y - Math.sin(angle - 0.42) * 11,
        );
        ctx.lineTo(
            end.x - Math.cos(angle + 0.42) * 11,
            end.y - Math.sin(angle + 0.42) * 11,
        );
        ctx.closePath();
        ctx.fill();

        ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = CAD_THEME.ink;
        ctx.fillText(
            'UP',
            start.x + Math.cos(angle) * 16,
            start.y + Math.sin(angle) * 16 - 8,
        );
        ctx.restore();
    });
}

/** Radius of a structural grid bubble on paper. */
const GRID_BUBBLE_RADIUS = 11;

/**
 * Structural grids: a dash-dot line with a lettered bubble at each end,
 * drawn under the model the way Revit datum lines are.
 */
function drawGridLines(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<GridElement>(scene, 'grid').forEach((grid) => {
        const selected = scene.selection.has(grid.id);
        const from = toScreen(grid.a);
        const to = toScreen(grid.b);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        ctx.save();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.datum;
        ctx.lineWidth = selected ? 1.6 : 0.9;
        ctx.setLineDash([14, 4, 3, 4]);

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '600 11px Karla, ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        [
            { at: from, direction: angle + Math.PI },
            { at: to, direction: angle },
        ].forEach(({ at, direction }) => {
            const centre = {
                x: at.x + Math.cos(direction) * (GRID_BUBBLE_RADIUS + 2),
                y: at.y + Math.sin(direction) * (GRID_BUBBLE_RADIUS + 2),
            };

            ctx.beginPath();
            ctx.arc(centre.x, centre.y, GRID_BUBBLE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = CAD_THEME.paper;
            ctx.fill();
            ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.datum;
            ctx.lineWidth = 1.1;
            ctx.stroke();

            ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.datum;
            ctx.fillText(grid.label, centre.x, centre.y + 0.5);
        });

        ctx.restore();
    });
}

/** Structural framing in plan: a dashed centre line between the supports. */
function drawBeams(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<BeamElement>(scene, 'beam').forEach((beam) => {
        const selected = scene.selection.has(beam.id);
        const from = toScreen(beam.a);
        const to = toScreen(beam.b);
        const along = normalize(subtract(beam.b, beam.a));
        const side = scale(perpendicular(along), beam.width / 2);

        ctx.save();

        // Section width as a light body under the centre line.
        ctx.beginPath();
        tracePolygon(
            ctx,
            [
                add(beam.a, side),
                add(beam.b, side),
                subtract(beam.b, side),
                subtract(beam.a, side),
            ],
            toScreen,
        );
        ctx.fillStyle = selected
            ? CAD_THEME.selectionFill
            : 'rgba(74, 69, 63, 0.12)';
        ctx.fill();

        ctx.beginPath();
        ctx.setLineDash([9, 5]);
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        ctx.lineWidth = selected ? 2 : 1.1;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    });
}

/* ---------------------------------------------- phasing & new annotations */

/**
 * Phase visibility, mirroring Revit's phase filters: `all` shows everything,
 * `new` shows only new work, `existing` shows the as-built state.
 */
export function phaseVisible(
    element: { phase?: Phase },
    filter: ViewSettings['phaseFilter'],
): boolean {
    const phase = element.phase ?? 'new';

    if (filter === 'new') {
        return phase === 'new';
    }

    if (filter === 'existing') {
        return phase === 'existing';
    }

    return true;
}

/** Line/fill treatment for an element's phase: existing greys, demo dashes. */
function applyPhaseGraphics(
    ctx: CanvasRenderingContext2D,
    element: { phase?: Phase },
): void {
    if (element.phase === 'existing') {
        ctx.globalAlpha *= 0.45;
    }

    if (element.phase === 'demolished') {
        ctx.globalAlpha *= 0.75;
        ctx.setLineDash([6, 4]);
    }
}

/** Reference planes: the green dash-dot datum Revit shows. */
function drawReferencePlanes(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<ReferencePlaneElement>(scene, 'referencePlane').forEach(
        (plane) => {
            const selected = scene.selection.has(plane.id);
            const from = toScreen(plane.a);
            const to = toScreen(plane.b);

            ctx.save();
            ctx.strokeStyle = selected
                ? CAD_THEME.selection
                : CAD_THEME.referencePlane;
            ctx.lineWidth = selected ? 1.6 : 1;
            ctx.setLineDash([12, 4, 2, 4]);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            ctx.setLineDash([]);

            if (plane.name) {
                ctx.font = '400 10px Karla, ui-sans-serif, sans-serif';
                ctx.fillStyle = CAD_THEME.referencePlane;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillText(plane.name, to.x + 4, to.y - 2);
            }

            ctx.restore();
        },
    );
}

/** Ramps: outline with a slope arrow and UP label, like a stair without treads. */
function drawRamps(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<RampElement>(scene, 'ramp').forEach((ramp) => {
        if (distance(ramp.a, ramp.b) < 100) {
            return;
        }

        const selected = scene.selection.has(ramp.id);
        const along = normalize(subtract(ramp.b, ramp.a));
        const side = scale(perpendicular(along), ramp.width / 2);

        ctx.save();
        applyPhaseGraphics(ctx, ramp);
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.ink;
        ctx.lineWidth = selected ? 2 : 1.1;

        ctx.beginPath();
        tracePolygon(
            ctx,
            [
                add(ramp.a, side),
                add(ramp.b, side),
                subtract(ramp.b, side),
                subtract(ramp.a, side),
            ],
            toScreen,
        );
        ctx.stroke();

        const start = toScreen(ramp.a);
        const end = toScreen(ramp.b);
        const angle = Math.atan2(end.y - start.y, end.x - start.x);

        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.ink;
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(
            end.x - Math.cos(angle - 0.42) * 11,
            end.y - Math.sin(angle - 0.42) * 11,
        );
        ctx.lineTo(
            end.x - Math.cos(angle + 0.42) * 11,
            end.y - Math.sin(angle + 0.42) * 11,
        );
        ctx.closePath();
        ctx.fill();

        ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('UP', (start.x + end.x) / 2, (start.y + end.y) / 2 - 9);
        ctx.restore();
    });
}

/** Revision clouds: scalloped arcs bulging outward around the sketch. */
function drawRevisionClouds(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<RevisionCloudElement>(scene, 'revisionCloud').forEach(
        (cloud) => {
            if (cloud.points.length < 2) {
                return;
            }

            const selected = scene.selection.has(cloud.id);
            const screen = cloud.points.map(toScreen);

            ctx.save();
            ctx.strokeStyle = selected
                ? CAD_THEME.selection
                : CAD_THEME.revision;
            ctx.lineWidth = selected ? 2 : 1.3;
            ctx.beginPath();

            for (let index = 0; index < screen.length; index++) {
                const from = screen[index];
                const to = screen[(index + 1) % screen.length];
                const length = Math.hypot(to.x - from.x, to.y - from.y);
                const arcs = Math.max(Math.round(length / 26), 1);

                for (let arc = 0; arc < arcs; arc++) {
                    const t0 = arc / arcs;
                    const t1 = (arc + 1) / arcs;
                    const ax = from.x + (to.x - from.x) * t0;
                    const ay = from.y + (to.y - from.y) * t0;
                    const bx = from.x + (to.x - from.x) * t1;
                    const by = from.y + (to.y - from.y) * t1;
                    const mx = (ax + bx) / 2;
                    const my = (ay + by) / 2;
                    // Bulge to the left of travel, outward on a CCW sketch.
                    const nx = -(by - ay);
                    const ny = bx - ax;
                    const norm = Math.hypot(nx, ny) || 1;
                    const bulge = 9;

                    ctx.moveTo(ax, ay);
                    ctx.quadraticCurveTo(
                        mx + (nx / norm) * bulge,
                        my + (ny / norm) * bulge,
                        bx,
                        by,
                    );
                }
            }

            ctx.stroke();

            // Revision tag triangle at the first vertex.
            const anchor = screen[0];
            ctx.beginPath();
            ctx.moveTo(anchor.x, anchor.y - 12);
            ctx.lineTo(anchor.x - 10, anchor.y + 6);
            ctx.lineTo(anchor.x + 10, anchor.y + 6);
            ctx.closePath();
            ctx.fillStyle = CAD_THEME.paper;
            ctx.fill();
            ctx.stroke();
            ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.revision;
            ctx.fillText(cloud.revision, anchor.x, anchor.y);
            ctx.restore();
        },
    );
}

/** Section marks: the line, end flags, and view-direction arrows. */
function drawSectionMarks(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<SectionElement>(scene, 'section').forEach((section, index) => {
        const selected = scene.selection.has(section.id);
        const from = toScreen(section.a);
        const to = toScreen(section.b);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        // The view looks to the left of a→b travel.
        const look = angle - Math.PI / 2;

        ctx.save();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.datum;
        ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.datum;
        ctx.lineWidth = selected ? 2 : 1.3;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        [from, to].forEach((end) => {
            // Flag stem perpendicular to the line, pointing the view way.
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(
                end.x + Math.cos(look) * 14,
                end.y + Math.sin(look) * 14,
            );
            ctx.stroke();

            // Filled arrowhead showing the look direction.
            const tipX = end.x + Math.cos(look) * 14;
            const tipY = end.y + Math.sin(look) * 14;

            ctx.beginPath();
            ctx.moveTo(tipX + Math.cos(look) * 8, tipY + Math.sin(look) * 8);
            ctx.lineTo(
                tipX + Math.cos(look + 2.5) * 7,
                tipY + Math.sin(look + 2.5) * 7,
            );
            ctx.lineTo(
                tipX + Math.cos(look - 2.5) * 7,
                tipY + Math.sin(look - 2.5) * 7,
            );
            ctx.closePath();
            ctx.fill();
        });

        // Section bubble at the head end.
        ctx.beginPath();
        ctx.arc(from.x, from.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = CAD_THEME.paper;
        ctx.fill();
        ctx.stroke();
        ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.datum;
        ctx.fillText(String(index + 1), from.x, from.y + 0.5);
        ctx.restore();
    });
}

/**
 * Door and window tags with type marks — D1, W2 — indexed by the order of
 * the type catalogues, placed just off the opening on its swing side.
 */
function drawOpeningTags(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    ctx.save();
    ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    openingGeometries(scene).forEach((geometry) => {
        const { opening, host } = geometry;
        const isDoor = opening.kind === 'door';
        const catalogue = isDoor
            ? scene.document.doorTypes
            : scene.document.windowTypes;
        const typeIndex = Math.max(
            catalogue.findIndex((type) => type.id === opening.typeId),
            0,
        );
        const mark = `${isDoor ? 'D' : 'W'}${typeIndex + 1}`;
        const away = scale(
            host.normal,
            (opening.flipFace ? -1 : 1) * (host.thickness / 2 + 450),
        );
        const anchor = toScreen(add(geometry.center, away));
        const selected = scene.selection.has(opening.id);
        const colour = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;

        ctx.beginPath();

        if (isDoor) {
            // Doors carry an ellipse-ish tag, windows a rectangle.
            ctx.arc(anchor.x, anchor.y, 9, 0, Math.PI * 2);
        } else {
            ctx.rect(anchor.x - 11, anchor.y - 7, 22, 14);
        }

        ctx.fillStyle = CAD_THEME.paper;
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.fillStyle = colour;
        ctx.fillText(mark, anchor.x, anchor.y + 0.5);
    });

    ctx.restore();
}

/* ------------------------------------------------- site, structure below */

/** Toposurfaces: an earth fill with a sparse grass hatch, under everything. */
function drawToposurfaces(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<ToposurfaceElement>(scene, 'toposurface').forEach((topo) => {
        if (topo.points.length < 3) {
            return;
        }

        const selected = scene.selection.has(topo.id);

        ctx.save();
        applyPhaseGraphics(ctx, topo);
        ctx.beginPath();
        tracePolygon(ctx, topo.points, toScreen);
        ctx.fillStyle = selected ? CAD_THEME.selectionFill : CAD_THEME.topoFill;
        ctx.fill();
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.topo;
        ctx.lineWidth = selected ? 2 : 1.1;
        ctx.stroke();
        ctx.clip();

        // Sparse diagonal hatch so the ground reads as landscape, not slab.
        const screenPoints = topo.points.map(toScreen);
        const minX = Math.min(...screenPoints.map((p) => p.x));
        const maxX = Math.max(...screenPoints.map((p) => p.x));
        const minY = Math.min(...screenPoints.map((p) => p.y));
        const maxY = Math.max(...screenPoints.map((p) => p.y));
        const span = maxX - minX + (maxY - minY);

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.topo;
        ctx.globalAlpha *= 0.35;
        ctx.lineWidth = 0.6;

        for (let offset = 0; offset <= span; offset += 26) {
            ctx.moveTo(minX + offset, minY);
            ctx.lineTo(minX + offset - (maxY - minY), maxY);
        }

        ctx.stroke();
        ctx.restore();
    });
}

/** Building pads: a recessed patch of site, edged with a dashed cut line. */
function drawPads(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<PadElement>(scene, 'pad').forEach((pad) => {
        if (pad.points.length < 3) {
            return;
        }

        const selected = scene.selection.has(pad.id);

        ctx.save();
        applyPhaseGraphics(ctx, pad);
        ctx.beginPath();
        tracePolygon(ctx, pad.points, toScreen);
        ctx.fillStyle = selected
            ? CAD_THEME.selectionFill
            : CAD_THEME.paperShade;
        ctx.fill();
        ctx.setLineDash([8, 4]);
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkFaint;
        ctx.lineWidth = selected ? 2 : 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    });
}

/** Property lines: the heavy dash-dot legal boundary with vertex markers. */
function drawPropertyLines(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<PropertyLineElement>(scene, 'propertyLine').forEach((line) => {
        if (line.points.length < 2) {
            return;
        }

        const selected = scene.selection.has(line.id);
        const colour = selected ? CAD_THEME.selection : CAD_THEME.propertyLine;

        ctx.save();
        ctx.beginPath();
        tracePolygon(ctx, line.points, toScreen);
        ctx.setLineDash([16, 5, 3, 5, 3, 5]);
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 2.2 : 1.6;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = colour;
        line.points.forEach((point) => {
            const at = toScreen(point);
            ctx.fillRect(at.x - 2.5, at.y - 2.5, 5, 5);
        });

        ctx.restore();
    });
}

/** Pad footings: hidden below grade, so a dashed outline with faint diagonals. */
function drawFootings(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<FootingElement>(scene, 'footing').forEach((footing) => {
        const selected = scene.selection.has(footing.id);
        const half = footing.width / 2;
        const corners: Point[] = [
            { x: footing.p.x - half, y: footing.p.y - half },
            { x: footing.p.x + half, y: footing.p.y - half },
            { x: footing.p.x + half, y: footing.p.y + half },
            { x: footing.p.x - half, y: footing.p.y + half },
        ];

        ctx.save();
        applyPhaseGraphics(ctx, footing);
        ctx.beginPath();
        tracePolygon(ctx, corners, toScreen);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        ctx.lineWidth = selected ? 2 : 1.1;
        ctx.stroke();
        ctx.setLineDash([]);

        const [a, b, c, d] = corners.map(toScreen);

        ctx.beginPath();
        ctx.strokeStyle = CAD_THEME.inkFaint;
        ctx.lineWidth = 0.6;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(c.x, c.y);
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
        ctx.restore();
    });
}

/** Braces: a heavy dashed diagonal with a connection plate at each end. */
function drawBraces(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<BraceElement>(scene, 'brace').forEach((brace) => {
        const selected = scene.selection.has(brace.id);
        const from = toScreen(brace.a);
        const to = toScreen(brace.b);

        ctx.save();
        applyPhaseGraphics(ctx, brace);
        ctx.beginPath();
        ctx.setLineDash([12, 5]);
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        ctx.lineWidth = selected ? 2.4 : 1.6;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        [from, to].forEach((end) => {
            ctx.fillRect(end.x - 3, end.y - 3, 6, 6);
        });
        ctx.restore();
    });
}

/** Railings: the run with a baluster tick at every module. */
function drawRailings(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<RailingElement>(scene, 'railing').forEach((railing) => {
        const run = distance(railing.a, railing.b);

        if (run < 10) {
            return;
        }

        const selected = scene.selection.has(railing.id);
        const along = normalize(subtract(railing.b, railing.a));
        const tick = scale(perpendicular(along), 60);
        const from = toScreen(railing.a);
        const to = toScreen(railing.b);

        ctx.save();
        applyPhaseGraphics(ctx, railing);
        ctx.strokeStyle = selected ? CAD_THEME.selection : CAD_THEME.ink;
        ctx.lineWidth = selected ? 2.2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();

        const balusters = Math.max(Math.round(run / 300), 1);

        ctx.beginPath();
        ctx.lineWidth = selected ? 1.4 : 0.9;

        for (let index = 0; index <= balusters; index++) {
            const at = lerp(railing.a, railing.b, index / balusters);
            const above = toScreen(add(at, tick));
            const below = toScreen(subtract(at, tick));
            ctx.moveTo(above.x, above.y);
            ctx.lineTo(below.x, below.y);
        }

        ctx.stroke();
        ctx.restore();
    });
}

/* ----------------------------------------------------------- MEP services */

function ductColour(system: DuctSystem): string {
    const colours: Record<DuctSystem, string> = {
        supply: CAD_THEME.ductSupply,
        return: CAD_THEME.ductReturn,
        exhaust: CAD_THEME.ductExhaust,
    };

    return colours[system];
}

function pipeColour(system: PipeSystem): string {
    const colours: Record<PipeSystem, string> = {
        domestic: CAD_THEME.pipeDomestic,
        sanitary: CAD_THEME.pipeSanitary,
        hydronic: CAD_THEME.pipeHydronic,
        fire: CAD_THEME.pipeFire,
    };

    return colours[system];
}

/** Flow arrow drawn at the end of a service run. */
function drawFlowArrow(
    ctx: CanvasRenderingContext2D,
    from: Point,
    to: Point,
): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(
        to.x - Math.cos(angle - 0.42) * 10,
        to.y - Math.sin(angle - 0.42) * 10,
    );
    ctx.lineTo(
        to.x - Math.cos(angle + 0.42) * 10,
        to.y - Math.sin(angle + 0.42) * 10,
    );
    ctx.closePath();
    ctx.fill();
}

/**
 * Ducts in plan: the double line at true width, tinted by system, with a
 * dash-dot centre line and a flow arrow at the run's end.
 */
function drawDucts(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<DuctElement>(scene, 'duct').forEach((duct) => {
        if (distance(duct.a, duct.b) < 10) {
            return;
        }

        const selected = scene.selection.has(duct.id);
        const colour = selected ? CAD_THEME.selection : ductColour(duct.system);
        const along = normalize(subtract(duct.b, duct.a));
        const side = scale(perpendicular(along), duct.width / 2);

        ctx.save();
        applyPhaseGraphics(ctx, duct);

        ctx.beginPath();
        tracePolygon(
            ctx,
            [
                add(duct.a, side),
                add(duct.b, side),
                subtract(duct.b, side),
                subtract(duct.a, side),
            ],
            toScreen,
        );
        ctx.globalAlpha *= selected ? 1 : 0.92;
        ctx.fillStyle = selected
            ? CAD_THEME.selectionFill
            : 'rgba(42, 111, 143, 0.08)';
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 2 : 1.2;
        ctx.stroke();

        const from = toScreen(duct.a);
        const to = toScreen(duct.b);

        ctx.beginPath();
        ctx.setLineDash([10, 4, 2, 4]);
        ctx.lineWidth = 0.8;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = colour;
        drawFlowArrow(ctx, from, to);
        ctx.restore();
    });
}

/** Cable trays: two edge lines with ladder rungs at every module. */
function drawCableTrays(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<CableTrayElement>(scene, 'cableTray').forEach((tray) => {
        const run = distance(tray.a, tray.b);

        if (run < 10) {
            return;
        }

        const selected = scene.selection.has(tray.id);
        const colour = selected ? CAD_THEME.selection : CAD_THEME.cableTray;
        const along = normalize(subtract(tray.b, tray.a));
        const side = scale(perpendicular(along), tray.width / 2);

        ctx.save();
        applyPhaseGraphics(ctx, tray);
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 2 : 1.2;

        ctx.beginPath();
        [side, scale(side, -1)].forEach((offset) => {
            const from = toScreen(add(tray.a, offset));
            const to = toScreen(add(tray.b, offset));
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
        });
        ctx.stroke();

        const rungs = Math.max(Math.round(run / 300), 1);

        ctx.beginPath();
        ctx.lineWidth = 0.8;

        for (let index = 0; index <= rungs; index++) {
            const at = lerp(tray.a, tray.b, index / rungs);
            const above = toScreen(add(at, side));
            const below = toScreen(subtract(at, side));
            ctx.moveTo(above.x, above.y);
            ctx.lineTo(below.x, below.y);
        }

        ctx.stroke();
        ctx.restore();
    });
}

/** Pipes: a single-line run in the system colour with tick marks at the ends. */
function drawPipes(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<PipeElement>(scene, 'pipe').forEach((pipe) => {
        if (distance(pipe.a, pipe.b) < 10) {
            return;
        }

        const selected = scene.selection.has(pipe.id);
        const colour = selected ? CAD_THEME.selection : pipeColour(pipe.system);
        const from = toScreen(pipe.a);
        const to = toScreen(pipe.b);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);

        ctx.save();
        applyPhaseGraphics(ctx, pipe);
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 2.4 : 1.7;

        if (pipe.system === 'sanitary') {
            ctx.setLineDash([9, 5]);
        }

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Short perpendicular ticks close each end, reading as fittings.
        const tickX = Math.cos(angle + Math.PI / 2) * 5;
        const tickY = Math.sin(angle + Math.PI / 2) * 5;

        ctx.beginPath();
        ctx.lineWidth = selected ? 1.6 : 1.1;
        [from, to].forEach((end) => {
            ctx.moveTo(end.x - tickX, end.y - tickY);
            ctx.lineTo(end.x + tickX, end.y + tickY);
        });
        ctx.stroke();
        ctx.restore();
    });
}

/* ------------------------------------------------------ placed components */

/**
 * Components carry the plan symbol of their category: an X-ed diffuser, a
 * crossed luminaire circle, a canopy for planting, an open parking stall —
 * the shorthand a drawing reader already knows.
 */
function drawFixtures(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<FixtureElement>(scene, 'fixture').forEach((fixture) => {
        const selected = scene.selection.has(fixture.id);
        const colour = selected ? CAD_THEME.selection : CAD_THEME.inkSoft;
        const footprint = fixtureFootprint(fixture);
        const [a, b, c, d] = footprint.map(toScreen);
        const centre = toScreen(fixture.p);
        const radius =
            (Math.min(fixture.width, fixture.depth) / 2) *
            (distance(a, b) / Math.max(fixture.width, 1));

        ctx.save();
        applyPhaseGraphics(ctx, fixture);
        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 2 : 1.1;

        switch (fixture.category) {
            case 'planting': {
                // Canopy circle with radial ticks and the trunk at centre.
                const canopy = Math.max(radius, 4);

                ctx.beginPath();
                ctx.arc(centre.x, centre.y, canopy, 0, Math.PI * 2);
                ctx.fillStyle = selected
                    ? CAD_THEME.selectionFill
                    : CAD_THEME.topoFill;
                ctx.fill();
                ctx.strokeStyle = selected
                    ? CAD_THEME.selection
                    : CAD_THEME.topo;
                ctx.stroke();

                ctx.beginPath();

                for (let index = 0; index < 8; index++) {
                    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8;
                    ctx.moveTo(
                        centre.x + Math.cos(angle) * canopy * 0.55,
                        centre.y + Math.sin(angle) * canopy * 0.55,
                    );
                    ctx.lineTo(
                        centre.x + Math.cos(angle) * canopy,
                        centre.y + Math.sin(angle) * canopy,
                    );
                }

                ctx.lineWidth = 0.8;
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(centre.x, centre.y, 2.2, 0, Math.PI * 2);
                ctx.fillStyle = selected ? CAD_THEME.selection : CAD_THEME.topo;
                ctx.fill();
                break;
            }
            case 'parking': {
                // Stall open at the aisle end, with a centre tick.
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(d.x, d.y);
                ctx.lineTo(c.x, c.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();

                ctx.beginPath();
                ctx.lineWidth = 0.8;
                const backMid = midpoint(d, c);
                const frontMid = midpoint(a, b);
                const inset = lerp(frontMid, backMid, 0.25);
                ctx.moveTo(frontMid.x, frontMid.y);
                ctx.lineTo(inset.x, inset.y);
                ctx.stroke();
                break;
            }
            case 'lighting': {
                ctx.beginPath();
                ctx.arc(
                    centre.x,
                    centre.y,
                    Math.max(radius, 3),
                    0,
                    Math.PI * 2,
                );
                ctx.stroke();

                ctx.beginPath();
                ctx.lineWidth = 0.9;
                [0, Math.PI / 2].forEach((angle) => {
                    const reach = Math.max(radius, 3) * 1.35;
                    ctx.moveTo(
                        centre.x - Math.cos(angle) * reach,
                        centre.y - Math.sin(angle) * reach,
                    );
                    ctx.lineTo(
                        centre.x + Math.cos(angle) * reach,
                        centre.y + Math.sin(angle) * reach,
                    );
                });
                ctx.stroke();
                break;
            }
            case 'sprinkler': {
                ctx.beginPath();
                ctx.arc(
                    centre.x,
                    centre.y,
                    Math.max(radius, 2.5),
                    0,
                    Math.PI * 2,
                );
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(centre.x, centre.y, 1.4, 0, Math.PI * 2);
                ctx.fillStyle = colour;
                ctx.fill();
                break;
            }
            case 'electrical': {
                ctx.beginPath();
                tracePolygon(ctx, footprint, toScreen);
                ctx.fillStyle = selected
                    ? CAD_THEME.selectionFill
                    : CAD_THEME.wallPoche;
                ctx.fill();
                ctx.stroke();
                break;
            }
            case 'airTerminal': {
                ctx.beginPath();
                tracePolygon(ctx, footprint, toScreen);
                ctx.stroke();

                ctx.beginPath();
                ctx.lineWidth = 0.8;
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(c.x, c.y);
                ctx.moveTo(b.x, b.y);
                ctx.lineTo(d.x, d.y);
                ctx.stroke();
                break;
            }
            case 'plumbing': {
                ctx.beginPath();
                tracePolygon(ctx, footprint, toScreen);
                ctx.stroke();

                ctx.beginPath();
                ctx.lineWidth = 0.8;
                ctx.ellipse(
                    centre.x,
                    centre.y,
                    Math.max(distance(a, b) * 0.32, 2),
                    Math.max(distance(b, c) * 0.32, 2),
                    angleOf(subtract(b, a)),
                    0,
                    Math.PI * 2,
                );
                ctx.stroke();
                break;
            }
            default: {
                // Mechanical equipment and furniture: the plain footprint,
                // equipment with a single diagonal.
                ctx.beginPath();
                tracePolygon(ctx, footprint, toScreen);
                ctx.fillStyle = selected
                    ? CAD_THEME.selectionFill
                    : 'rgba(179, 164, 143, 0.12)';
                ctx.fill();
                ctx.stroke();

                if (fixture.category === 'mechanical') {
                    ctx.beginPath();
                    ctx.lineWidth = 0.8;
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(c.x, c.y);
                    ctx.stroke();
                }

                break;
            }
        }

        ctx.restore();
    });
}

/** Spot elevations: a target with a leader carrying the level's height. */
function drawSpotElevations(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    const spots = elementsOf<SpotElevationElement>(scene, 'spotElevation');

    if (spots.length === 0) {
        return;
    }

    const elevation =
        scene.document.levels.find((level) => level.id === scene.level)
            ?.elevation ?? 0;
    const label = formatLength(elevation, scene.units);

    ctx.save();
    ctx.font = '600 10px Karla, ui-sans-serif, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    spots.forEach((spot) => {
        const selected = scene.selection.has(spot.id);
        const colour = selected ? CAD_THEME.selection : CAD_THEME.dimension;
        const at = toScreen(spot.p);

        ctx.strokeStyle = colour;
        ctx.lineWidth = selected ? 1.8 : 1.1;

        ctx.beginPath();
        ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(at.x - 7, at.y);
        ctx.lineTo(at.x + 7, at.y);
        ctx.moveTo(at.x, at.y - 7);
        ctx.lineTo(at.x, at.y + 7);
        ctx.stroke();

        // Leader up-right to the value.
        ctx.beginPath();
        ctx.moveTo(at.x + 5, at.y - 5);
        ctx.lineTo(at.x + 16, at.y - 14);
        ctx.lineTo(at.x + 40, at.y - 14);
        ctx.stroke();

        ctx.fillStyle = colour;
        ctx.fillText(label, at.x + 18, at.y - 20);
    });

    ctx.restore();
}

/**
 * Walkthrough paths: a dashed camera route with a viewpoint glyph at the
 * start, direction arrows along the way and a numbered dot at every stop.
 */
function drawWalkthroughs(
    ctx: CanvasRenderingContext2D,
    scene: PlanScene,
    toScreen: (p: Point) => Point,
): void {
    elementsOf<WalkthroughElement>(scene, 'walkthrough').forEach((path) => {
        if (path.points.length < 2) {
            return;
        }

        const selected = scene.selection.has(path.id);
        const colour = selected ? CAD_THEME.selection : CAD_THEME.datum;
        const screen = path.points.map(toScreen);

        ctx.save();
        ctx.strokeStyle = colour;
        ctx.fillStyle = colour;
        ctx.lineWidth = selected ? 2 : 1.3;

        ctx.beginPath();
        ctx.setLineDash([9, 6]);
        ctx.moveTo(screen[0].x, screen[0].y);
        screen.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        ctx.setLineDash([]);

        // A direction arrow at the middle of every segment.
        for (let index = 1; index < screen.length; index++) {
            const from = screen[index - 1];
            const to = screen[index];
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            const mid = midpoint(from, to);

            ctx.beginPath();
            ctx.moveTo(
                mid.x + Math.cos(angle) * 6,
                mid.y + Math.sin(angle) * 6,
            );
            ctx.lineTo(
                mid.x + Math.cos(angle + 2.5) * 6,
                mid.y + Math.sin(angle + 2.5) * 6,
            );
            ctx.lineTo(
                mid.x + Math.cos(angle - 2.5) * 6,
                mid.y + Math.sin(angle - 2.5) * 6,
            );
            ctx.closePath();
            ctx.fill();
        }

        // Numbered stop at every vertex.
        ctx.font = '600 9px Karla, ui-sans-serif, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        screen.forEach((stop, index) => {
            ctx.beginPath();
            ctx.arc(stop.x, stop.y, 7, 0, Math.PI * 2);
            ctx.fillStyle = CAD_THEME.paper;
            ctx.fill();
            ctx.strokeStyle = colour;
            ctx.lineWidth = 1.1;
            ctx.stroke();
            ctx.fillStyle = colour;
            ctx.fillText(String(index + 1), stop.x, stop.y + 0.5);
        });

        // Camera glyph at the start: a small body with its lens aimed along.
        const start = screen[0];
        const aim = Math.atan2(screen[1].y - start.y, screen[1].x - start.x);

        ctx.beginPath();
        ctx.moveTo(start.x + Math.cos(aim) * 16, start.y + Math.sin(aim) * 16);
        ctx.lineTo(
            start.x + Math.cos(aim + 0.5) * 9,
            start.y + Math.sin(aim + 0.5) * 9,
        );
        ctx.lineTo(
            start.x + Math.cos(aim - 0.5) * 9,
            start.y + Math.sin(aim - 0.5) * 9,
        );
        ctx.closePath();
        ctx.fillStyle = colour;
        ctx.fill();

        ctx.restore();
    });
}
