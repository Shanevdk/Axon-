import { normalizeDocument } from '@/hooks/use-cad-document';
import {
    add,
    boundsOf,
    expandBounds,
    scale,
    subtract,
} from '@/lib/cad/geometry';
import {
    buildOpeningGeometry,
    buildWallGeometry,
    wallsOnLevel,
} from '@/lib/cad/model';
import type { WallGeometry } from '@/lib/cad/model';
import { computeRoomBoundaries } from '@/lib/cad/rooms';
import type { RoomBoundary } from '@/lib/cad/rooms';
import { CAD_THEME } from '@/lib/cad/theme';
import type {
    CadDocument,
    FloorElement,
    OpeningElement,
    Point,
    RoomElement,
} from '@/lib/cad/types';
import { cn } from '@/lib/utils';

export type PlanModel = {
    walls: WallGeometry[];
    openings: ReturnType<typeof buildOpeningGeometry>[];
    floors: Point[][];
    rooms: { element: RoomElement; boundary: RoomBoundary }[];
    /** Combined area of every enclosed room on the level, in square millimetres. */
    roomArea: number;
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

/**
 * Resolve a stored document into everything a thumbnail needs.
 *
 * This runs the same wall joining and room detection the editor uses, so a
 * thumbnail is a true miniature of the plan rather than an approximation.
 * Callers should memoise it — the room fill is a flood fill.
 */
export function buildPlanModel(
    document: CadDocument | null,
    levelId?: string,
): PlanModel | null {
    if (!document) {
        return null;
    }

    const model = normalizeDocument(document);
    const level = levelId ?? model.levels[0]?.id;

    if (!level) {
        return null;
    }

    const walls = [
        ...buildWallGeometry(model, wallsOnLevel(model, level)).values(),
    ];

    const openings = model.elements
        .filter(
            (element): element is OpeningElement =>
                (element.kind === 'door' || element.kind === 'window') &&
                element.level === level,
        )
        .map((opening) => {
            const host = walls.find((wall) => wall.wall.id === opening.host);

            return host ? buildOpeningGeometry(model, opening, host) : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    const floors = model.elements
        .filter(
            (element): element is FloorElement =>
                element.kind === 'floor' && element.level === level,
        )
        .map((floor) => floor.points);

    const tags = model.elements.filter(
        (element): element is RoomElement =>
            element.kind === 'room' && element.level === level,
    );
    const boundaries = computeRoomBoundaries(tags, walls);

    const rooms = tags
        .map((element) => {
            const boundary = boundaries.get(element.id);

            return boundary ? { element, boundary } : null;
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

    const bounds = boundsOf([
        ...walls.flatMap((wall) => wall.polygon),
        ...floors.flat(),
    ]);

    return {
        walls,
        openings,
        floors,
        rooms,
        roomArea: rooms.reduce((total, room) => total + room.boundary.area, 0),
        bounds,
    };
}

type PlanThumbnailProps = {
    model: PlanModel | null;
    className?: string;
    /** Room fills read well at card size but clutter a list row. */
    showRooms?: boolean;
};

/**
 * A miniature of the floor plan. Stroke widths use `non-scaling-stroke` so the
 * line weights stay legible whatever size the thumbnail is drawn at.
 */
export function PlanThumbnail({
    model,
    className,
    showRooms = true,
}: PlanThumbnailProps) {
    if (!model?.bounds || model.walls.length === 0) {
        return <EmptyPlan className={className} />;
    }

    const bounds = expandBounds(model.bounds, 600);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;

    // The model has Y running up; flip it so the plan reads the right way round.
    const path = (points: Point[]) =>
        points.map((p) => `${p.x.toFixed(0)},${(-p.y).toFixed(0)}`).join(' ');

    return (
        <svg
            viewBox={`${bounds.minX} ${-bounds.maxY} ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            className={cn('h-full w-full', className)}
            role="img"
            aria-label="Floor plan"
        >
            {model.floors.map((points, index) => (
                <polygon
                    key={`floor-${index}`}
                    points={path(points)}
                    fill={CAD_THEME.paperShade}
                    stroke={CAD_THEME.inkFaint}
                    strokeWidth={0.5}
                    vectorEffect="non-scaling-stroke"
                />
            ))}

            {showRooms &&
                model.rooms.map((room) => (
                    <polygon
                        key={room.element.id}
                        points={path(room.boundary.polygon)}
                        fill={CAD_THEME.roomFill}
                    />
                ))}

            {model.walls.map((wall) => (
                <polygon
                    key={`fill-${wall.wall.id}`}
                    points={path(wall.polygon)}
                    fill={
                        wall.type.function === 'exterior'
                            ? CAD_THEME.wallFill
                            : CAD_THEME.wallFillInterior
                    }
                />
            ))}

            {model.walls.map((wall) => (
                <polygon
                    key={`line-${wall.wall.id}`}
                    points={path(wall.polygon)}
                    fill="none"
                    stroke={
                        wall.type.function === 'exterior'
                            ? CAD_THEME.wallExterior
                            : CAD_THEME.wallInterior
                    }
                    strokeWidth={wall.type.function === 'exterior' ? 1.1 : 0.8}
                    vectorEffect="non-scaling-stroke"
                />
            ))}

            {/* Punch the openings, which also clears the wall face lines crossing them. */}
            {model.openings.map((opening) => (
                <polygon
                    key={`void-${opening.opening.id}`}
                    points={path(opening.polygon)}
                    fill={CAD_THEME.paper}
                />
            ))}

            {model.openings.map((opening) => {
                const reach = scale(
                    opening.host.normal,
                    opening.host.thickness / 2,
                );

                return (
                    <g key={`jamb-${opening.opening.id}`}>
                        {[opening.jambA, opening.jambB].map((jamb, index) => (
                            <polyline
                                key={index}
                                points={path([
                                    add(jamb, reach),
                                    subtract(jamb, reach),
                                ])}
                                fill="none"
                                stroke={CAD_THEME.wallExterior}
                                strokeWidth={0.8}
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}
                        {opening.opening.kind === 'window' && (
                            <polyline
                                points={path([opening.jambA, opening.jambB])}
                                fill="none"
                                stroke={CAD_THEME.glass}
                                strokeWidth={0.9}
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

function EmptyPlan({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                'flex h-full w-full items-center justify-center bg-paper-warm',
                className,
            )}
        >
            <svg
                viewBox="0 0 60 40"
                className="h-8 w-12 text-sand"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
            >
                <path d="M4 36V14L30 4l26 10v22" strokeLinecap="square" />
                <path d="M22 36V22h16v14" strokeLinecap="square" />
            </svg>
        </div>
    );
}
