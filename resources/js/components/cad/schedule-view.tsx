import { Download } from 'lucide-react';
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
import {
    formatQuantity,
    orderQuantity,
    SECTION_LABELS,
    SECTION_ORDER,
    takeOff,
    takeoffCsv,
} from '@/lib/cad/takeoff';
import type { TakeoffSection } from '@/lib/cad/takeoff';
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
    // The bill of materials is grouped by trade rather than listed by
    // element, so it gets a sheet of its own rather than a column set.
    if (kind === 'materials') {
        return <MaterialsSchedule editor={editor} />;
    }

    return <TableSchedule editor={editor} kind={kind} />;
}

function TableSchedule({
    editor,
    kind,
}: {
    editor: CadEditor;
    kind: Exclude<ScheduleKind, 'materials'>;
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
                        Vanhaven
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

/* ------------------------------------------------------- bill of materials */

/**
 * What the model is built from, grouped by trade.
 *
 * The measured column is what the drawing says; the order column is what to
 * actually buy, waste included. Both are shown because an estimator wants to
 * see the allowance rather than have it folded in silently.
 */
/** Trades counted by rule of thumb rather than measured off the drawing. */
const ALLOWANCE_SECTIONS: TakeoffSection[] = [
    'electrical',
    'plumbing',
    'hvac',
];

function MaterialsSchedule({ editor }: { editor: CadEditor }) {
    const { document } = editor;
    const takeoff = useMemo(() => takeOff(document), [document]);
    const units = document.units;

    const sections = SECTION_ORDER.map((section) => ({
        section,
        lines: takeoff.lines.filter((line) => line.section === section),
    })).filter((group) => group.lines.length > 0);

    const download = () => {
        const blob = new Blob([takeoffCsv(takeoff, units)], {
            type: 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const link = window.document.createElement('a');

        link.href = url;
        link.download = 'bill-of-materials.csv';
        link.click();

        URL.revokeObjectURL(url);
    };

    return (
        <div className="h-full overflow-auto bg-paper-warm p-8 text-ink">
            <div className="mx-auto max-w-4xl">
                <header className="mb-5 flex items-end justify-between gap-4 border-b-2 border-ink pb-3">
                    <div>
                        <p className="ax-eyebrow text-[0.62rem] text-ink-muted">
                            Vanhaven
                        </p>
                        <h1 className="mt-1 text-xl font-semibold tracking-tight">
                            Bill of Materials
                        </h1>
                        <p className="mt-0.5 text-xs text-ink-muted">
                            {takeoff.lines.length}{' '}
                            {takeoff.lines.length === 1 ? 'line' : 'lines'} from{' '}
                            {takeoff.counted}{' '}
                            {takeoff.counted === 1 ? 'element' : 'elements'} ·{' '}
                            {units === 'imperial' ? 'Imperial' : 'Metric'}
                        </p>
                    </div>

                    {takeoff.lines.length > 0 && (
                        <button
                            type="button"
                            onClick={download}
                            className="flex shrink-0 items-center gap-1.5 rounded-sm border border-ink/30 px-2.5 py-1.5 text-xs transition-colors hover:bg-ink hover:text-paper"
                        >
                            <Download className="size-3.5" />
                            Download CSV
                        </button>
                    )}
                </header>

                {takeoff.lines.length === 0 ? (
                    <p className="py-12 text-center text-sm text-ink-muted">
                        Nothing to build yet. Draw some walls, floors or
                        footings and the materials to buy will be listed here.
                    </p>
                ) : (
                    <>
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-ink/40">
                                    <th className="px-2 py-2 text-left text-[0.68rem] font-semibold tracking-wider uppercase">
                                        Material
                                    </th>
                                    <th className="px-2 py-2 text-right text-[0.68rem] font-semibold tracking-wider uppercase">
                                        Measured
                                    </th>
                                    <th className="px-2 py-2 text-right text-[0.68rem] font-semibold tracking-wider uppercase">
                                        Waste
                                    </th>
                                    <th className="px-2 py-2 text-right text-[0.68rem] font-semibold tracking-wider uppercase">
                                        Order
                                    </th>
                                    <th className="px-2 py-2 text-right text-[0.68rem] font-semibold tracking-wider uppercase">
                                        From
                                    </th>
                                </tr>
                            </thead>

                            {sections.map((group) => (
                                <tbody key={group.section}>
                                    <tr>
                                        <td
                                            colSpan={5}
                                            className="border-b border-ink/20 bg-sand/25 px-2 pt-4 pb-1 text-[0.66rem] font-semibold tracking-wider uppercase"
                                        >
                                            {SECTION_LABELS[group.section]}
                                        </td>
                                    </tr>
                                    {group.lines.map((line) => (
                                        <tr
                                            key={line.key}
                                            className="border-b border-ink/10"
                                        >
                                            <td className="px-2 py-1.5">
                                                {line.material}
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">
                                                {formatQuantity(
                                                    line.quantity,
                                                    line.unit,
                                                    units,
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-ink-muted tabular-nums">
                                                {line.waste > 0
                                                    ? `${Math.round(line.waste * 100)}%`
                                                    : '—'}
                                            </td>
                                            <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                                                {formatQuantity(
                                                    orderQuantity(line),
                                                    line.unit,
                                                    units,
                                                )}
                                            </td>
                                            <td className="px-2 py-1.5 text-right text-ink-muted tabular-nums">
                                                {line.from}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            ))}
                        </table>

                        <p className="mt-5 border-t border-ink/20 pt-3 text-[0.7rem] leading-relaxed text-ink-muted">
                            Quantities are measured off the model as drawn, at
                            400mm framing centres, and only for work in the new
                            phase. Waste is a cutting allowance on sheet goods
                            and sawn lengths, never on anything counted by the
                            piece. Check it against a real estimate before
                            anybody orders anything.{' '}
                            {ALLOWANCE_SECTIONS.some((section) =>
                                sections.some(
                                    (group) => group.section === section,
                                ),
                            ) && (
                                <>
                                    Electrical, plumbing and HVAC are
                                    allowances worked out from the floor area
                                    and the rooms, because nothing in the
                                    drawing says where a socket or a run of
                                    pipe goes. Draw the services and they are
                                    measured properly instead.
                                </>
                            )}
                            {takeoff.unknown > 0 && (
                                <>
                                    {' '}
                                    {takeoff.unknown} imported{' '}
                                    {takeoff.unknown === 1
                                        ? 'model is'
                                        : 'models are'}{' '}
                                    listed by name only — nothing here knows
                                    what they are made of.
                                </>
                            )}
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
