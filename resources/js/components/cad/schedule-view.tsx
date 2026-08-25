import { useMemo } from 'react';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { distance } from '@/lib/cad/geometry';
import {
    buildWallGeometry,
    doorTypeOf,
    wallsOnLevel,
    wallTypeOf,
    windowTypeOf,
} from '@/lib/cad/model';
import { computeRoomBoundaries } from '@/lib/cad/rooms';
import type {
    OpeningElement,
    RoomElement,
    ScheduleKind,
    WallElement,
} from '@/lib/cad/types';
import { formatArea, formatLength } from '@/lib/cad/units';

type Column = { key: string; label: string; align?: 'left' | 'right' };

type Row = Record<string, string>;

/**
 * Schedules read straight off the model, the way a Revit schedule view does —
 * change a wall type or a room name and the table follows.
 */
export function ScheduleView({
    editor,
    kind,
}: {
    editor: CadEditor;
    kind: ScheduleKind;
}) {
    const { document } = editor;

    const { columns, rows, title } = useMemo(() => {
        switch (kind) {
            case 'room':
                return roomSchedule(editor);
            case 'door':
                return openingSchedule(editor, 'door');
            case 'window':
                return openingSchedule(editor, 'window');
            case 'wall':
                return wallSchedule(editor);
        }
    }, [editor, kind]);

    return (
        <div className="h-full overflow-auto bg-paper-warm p-8 text-ink">
            <div className="mx-auto max-w-4xl">
                <header className="mb-5 border-b-2 border-ink pb-3">
                    <p className="ax-eyebrow text-[0.62rem] text-ink-muted">
                        Axon
                    </p>
                    <h1 className="mt-1 text-xl font-semibold tracking-tight">
                        {title}
                    </h1>
                    <p className="mt-0.5 text-xs text-ink-muted">
                        {rows.length} {rows.length === 1 ? 'entry' : 'entries'}{' '}
                        ·{' '}
                        {document.units === 'imperial' ? 'Imperial' : 'Metric'}
                    </p>
                </header>

                {rows.length === 0 ? (
                    <p className="py-12 text-center text-sm text-ink-muted">
                        Nothing to schedule yet. Draw some model elements and
                        they will appear here.
                    </p>
                ) : (
                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-ink/40">
                                {columns.map((column) => (
                                    <th
                                        key={column.key}
                                        className="px-2 py-2 text-left text-[0.68rem] font-semibold tracking-wider uppercase"
                                        style={{
                                            textAlign: column.align ?? 'left',
                                        }}
                                    >
                                        {column.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr
                                    key={row.key ?? index}
                                    className="border-b border-ink/10 odd:bg-sand/10"
                                >
                                    {columns.map((column) => (
                                        <td
                                            key={column.key}
                                            className="px-2 py-1.5 tabular-nums"
                                            style={{
                                                textAlign:
                                                    column.align ?? 'left',
                                            }}
                                        >
                                            {row[column.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function roomSchedule(editor: CadEditor): {
    columns: Column[];
    rows: Row[];
    title: string;
} {
    const { document } = editor;
    const columns: Column[] = [
        { key: 'number', label: 'Number' },
        { key: 'name', label: 'Name' },
        { key: 'level', label: 'Level' },
        { key: 'area', label: 'Area', align: 'right' },
        { key: 'perimeter', label: 'Perimeter', align: 'right' },
    ];

    const rows: Row[] = [];

    document.levels.forEach((level) => {
        const tags = document.elements.filter(
            (element): element is RoomElement =>
                element.kind === 'room' && element.level === level.id,
        );

        if (tags.length === 0) {
            return;
        }

        const geometry = [
            ...buildWallGeometry(
                document,
                wallsOnLevel(document, level.id),
            ).values(),
        ];
        const boundaries = computeRoomBoundaries(tags, geometry);

        tags.forEach((room) => {
            const boundary = boundaries.get(room.id);

            rows.push({
                key: room.id,
                number: room.number,
                name: room.name,
                level: level.name,
                area: boundary
                    ? formatArea(boundary.area, document.units)
                    : 'Not Enclosed',
                perimeter: boundary
                    ? formatLength(boundary.perimeter, document.units)
                    : '—',
            });
        });
    });

    return {
        columns,
        rows: rows.sort((a, b) => a.number.localeCompare(b.number)),
        title: 'Room Schedule',
    };
}

function openingSchedule(
    editor: CadEditor,
    kind: 'door' | 'window',
): { columns: Column[]; rows: Row[]; title: string } {
    const { document } = editor;
    const columns: Column[] = [
        { key: 'mark', label: 'Mark' },
        { key: 'type', label: 'Type' },
        { key: 'level', label: 'Level' },
        { key: 'width', label: 'Width', align: 'right' },
        { key: 'height', label: 'Height', align: 'right' },
        {
            key: 'sill',
            label: kind === 'door' ? 'Head' : 'Sill',
            align: 'right',
        },
        { key: 'host', label: 'Host Wall' },
    ];

    const openings = document.elements.filter(
        (element): element is OpeningElement => element.kind === kind,
    );

    const rows = openings.map((opening, index) => {
        const level = document.levels.find((item) => item.id === opening.level);
        const host = document.elements.find((item) => item.id === opening.host);
        const size =
            kind === 'door'
                ? doorTypeOf(document, opening.typeId)
                : windowTypeOf(document, opening.typeId);
        const sill = 'sillHeight' in size ? size.sillHeight : 0;

        return {
            key: opening.id,
            mark: `${kind === 'door' ? 'D' : 'W'}${String(index + 1).padStart(2, '0')}`,
            type: size.name,
            level: level?.name ?? '—',
            width: formatLength(size.width, document.units),
            height: formatLength(size.height, document.units),
            sill: formatLength(
                kind === 'door' ? size.height : sill,
                document.units,
            ),
            host:
                host?.kind === 'wall'
                    ? wallTypeOf(document, host.typeId).name
                    : 'Missing host',
        };
    });

    return {
        columns,
        rows,
        title: kind === 'door' ? 'Door Schedule' : 'Window Schedule',
    };
}

function wallSchedule(editor: CadEditor): {
    columns: Column[];
    rows: Row[];
    title: string;
} {
    const { document } = editor;
    const columns: Column[] = [
        { key: 'type', label: 'Type' },
        { key: 'level', label: 'Level' },
        { key: 'count', label: 'Count', align: 'right' },
        { key: 'length', label: 'Total Length', align: 'right' },
        { key: 'area', label: 'Total Area', align: 'right' },
    ];

    const grouped = new Map<
        string,
        { count: number; length: number; area: number }
    >();

    document.elements
        .filter((element): element is WallElement => element.kind === 'wall')
        .forEach((wall) => {
            const key = `${wall.level}::${wall.typeId}`;
            const current = grouped.get(key) ?? {
                count: 0,
                length: 0,
                area: 0,
            };
            const length = distance(wall.a, wall.b);

            grouped.set(key, {
                count: current.count + 1,
                length: current.length + length,
                area: current.area + length * wall.height,
            });
        });

    const rows = [...grouped.entries()].map(([key, totals]) => {
        const [levelId, typeId] = key.split('::');

        return {
            key,
            type: wallTypeOf(document, typeId).name,
            level:
                document.levels.find((item) => item.id === levelId)?.name ??
                '—',
            count: String(totals.count),
            length: formatLength(totals.length, document.units),
            area: formatArea(totals.area, document.units),
        };
    });

    return { columns, rows, title: 'Wall Schedule' };
}
