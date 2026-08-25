import { Magnet, MoveHorizontal } from 'lucide-react';
import type { CadEditor } from '@/hooks/use-cad-editor';
import type { DrawMode, LocationLine } from '@/lib/cad/types';
import { formatLength, parseLength } from '@/lib/cad/units';
import { cn } from '@/lib/utils';

const DRAW_MODES: { id: DrawMode; label: string }[] = [
    { id: 'line', label: 'Line' },
    { id: 'rectangle', label: 'Rectangle' },
    { id: 'polygon', label: 'Polygon' },
];

const LOCATION_LINES: { id: LocationLine; label: string }[] = [
    { id: 'center', label: 'Wall Centreline' },
    { id: 'left', label: 'Finish Face: Exterior' },
    { id: 'right', label: 'Finish Face: Interior' },
];

/**
 * The contextual strip under the ribbon, carrying the settings that apply to
 * whatever tool is currently armed.
 */
export function OptionsBar({ editor }: { editor: CadEditor }) {
    const { tool, document } = editor;

    return (
        <div className="flex h-9 shrink-0 scrollbar-chrome items-center gap-3 overflow-x-auto border-b border-chrome-border bg-chrome px-3 text-[0.75rem] text-chrome-fg">
            <span className="shrink-0 text-chrome-muted">
                {tool === 'select' ? 'Modify' : labelFor(tool)}
            </span>

            <div className="h-4 w-px shrink-0 bg-chrome-border" />

            {tool === 'wall' && (
                <>
                    <Field label="Type">
                        <Select
                            value={editor.wallTypeId}
                            onChange={editor.setWallTypeId}
                            options={document.wallTypes.map((type) => ({
                                value: type.id,
                                label: type.name,
                            }))}
                        />
                    </Field>
                    <Field label="Height">
                        <LengthInput
                            value={editor.wallHeight}
                            units={document.units}
                            onCommit={editor.setWallHeight}
                        />
                    </Field>
                    <Field label="Location Line">
                        <Select
                            value={editor.locationLine}
                            onChange={(value) =>
                                editor.setLocationLine(value as LocationLine)
                            }
                            options={LOCATION_LINES.map((item) => ({
                                value: item.id,
                                label: item.label,
                            }))}
                        />
                    </Field>
                    <SegmentedControl
                        value={editor.drawMode}
                        options={DRAW_MODES}
                        onChange={editor.setDrawMode}
                    />
                </>
            )}

            {tool === 'door' && (
                <Field label="Type">
                    <Select
                        value={editor.doorTypeId}
                        onChange={editor.setDoorTypeId}
                        options={document.doorTypes.map((type) => ({
                            value: type.id,
                            label: type.name,
                        }))}
                    />
                </Field>
            )}

            {tool === 'window' && (
                <Field label="Type">
                    <Select
                        value={editor.windowTypeId}
                        onChange={editor.setWindowTypeId}
                        options={document.windowTypes.map((type) => ({
                            value: type.id,
                            label: type.name,
                        }))}
                    />
                </Field>
            )}

            {tool === 'roof' && (
                <>
                    <Field label="Slope">
                        <NumberInput
                            value={editor.roofSlope}
                            suffix="°"
                            min={5}
                            max={75}
                            onCommit={editor.setRoofSlope}
                        />
                    </Field>
                    <Field label="Overhang">
                        <LengthInput
                            value={editor.roofOverhang}
                            units={document.units}
                            onCommit={editor.setRoofOverhang}
                        />
                    </Field>
                </>
            )}

            {tool === 'stair' && (
                <Field label="Width">
                    <LengthInput
                        value={editor.stairWidth}
                        units={document.units}
                        onCommit={editor.setStairWidth}
                    />
                </Field>
            )}

            {tool === 'beam' && (
                <>
                    <Field label="Width">
                        <LengthInput
                            value={editor.beamSize.width}
                            units={document.units}
                            onCommit={(width) =>
                                editor.setBeamSize({
                                    ...editor.beamSize,
                                    width,
                                })
                            }
                        />
                    </Field>
                    <Field label="Depth">
                        <LengthInput
                            value={editor.beamSize.depth}
                            units={document.units}
                            onCommit={(depth) =>
                                editor.setBeamSize({
                                    ...editor.beamSize,
                                    depth,
                                })
                            }
                        />
                    </Field>
                </>
            )}

            {tool === 'offset' && (
                <Field label="Offset">
                    <LengthInput
                        value={editor.offsetDistance}
                        units={document.units}
                        onCommit={editor.setOffsetDistance}
                    />
                </Field>
            )}

            {tool === 'array' && (
                <Field label="Number">
                    <NumberInput
                        value={editor.arrayCount}
                        min={2}
                        max={50}
                        onCommit={editor.setArrayCount}
                    />
                </Field>
            )}

            {(tool === 'floor' ||
                tool === 'ceiling' ||
                tool === 'room' ||
                tool === 'dimension' ||
                tool === 'grid' ||
                tool === 'ramp' ||
                tool === 'referencePlane' ||
                tool === 'revisionCloud' ||
                tool === 'section' ||
                tool === 'trim' ||
                tool === 'split' ||
                tool === 'align' ||
                tool === 'measure') && (
                <span className="text-chrome-muted">{hintFor(tool)}</span>
            )}

            {(tool === 'move' ||
                tool === 'copy' ||
                tool === 'rotate' ||
                tool === 'mirror') && (
                <span className="text-chrome-muted">
                    {editor.selection.length === 0
                        ? 'Select elements first, then pick a start point'
                        : hintFor(tool)}
                </span>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <ToggleChip
                    active={editor.ortho}
                    onClick={() => editor.setOrtho(!editor.ortho)}
                    icon={<MoveHorizontal className="size-3.5" />}
                    label="Ortho"
                    hint="Hold Shift to constrain temporarily"
                />
                <ToggleChip
                    active={editor.snapsEnabled}
                    onClick={() => editor.setSnapsEnabled(!editor.snapsEnabled)}
                    icon={<Magnet className="size-3.5" />}
                    label="Snap"
                />
            </div>
        </div>
    );
}

function labelFor(tool: string): string {
    return `${tool[0].toUpperCase()}${tool.slice(1)}`;
}

function hintFor(tool: string): string {
    const hints: Record<string, string> = {
        floor: 'Click to sketch the boundary — click the first point again or press Enter to finish',
        room: 'Click inside an enclosed space to place a room',
        dimension: 'Pick two points to dimension between them',
        measure: 'Pick two points to measure — nothing is added to the model',
        move: 'Pick a start point, then a destination',
        copy: 'Pick a start point, then a destination for the copy',
        rotate: 'Pick the centre of rotation, then drag',
        mirror: 'Draw the mirror axis',
        ceiling:
            'Click to sketch the ceiling boundary — close it or press Enter to finish',
        grid: 'Pick two points for the grid line — the bubble label is automatic',
        trim: 'Click two walls to trim or extend them to a corner',
        split: 'Click along a wall to split it there',
        align: 'Click the reference wall, then the wall to align',
        ramp: 'Pick two points along the run — width comes from the stair width',
        referencePlane: 'Pick two points for the datum plane',
        revisionCloud:
            'Sketch around the changed work — close it or press Enter to finish',
        section:
            'Pick two points across the building; the view lands in the browser',
    };

    return hints[tool] ?? '';
}

function Field({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <label className="flex shrink-0 items-center gap-1.5">
            <span className="text-chrome-muted">{label}</span>
            {children}
        </label>
    );
}

type SelectProps = {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
};

function Select({ value, options, onChange }: SelectProps) {
    return (
        <select
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="max-w-56 rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-[0.75rem] text-chrome-fg outline-none focus:border-sand"
        >
            {options.map((option) => (
                <option
                    key={option.value}
                    value={option.value}
                    className="bg-chrome-sunken"
                >
                    {option.label}
                </option>
            ))}
        </select>
    );
}

type LengthInputProps = {
    value: number;
    units: 'metric' | 'imperial';
    onCommit: (value: number) => void;
};

/**
 * Accepts the same shorthand the drawing area does — `2700`, `2.7 m` or
 * `8' - 10"` — and only commits when the value parses.
 */
export function LengthInput({ value, units, onCommit }: LengthInputProps) {
    return (
        <input
            key={value}
            defaultValue={formatLength(value, units)}
            onBlur={(event) => {
                const parsed = parseLength(event.target.value, units);

                if (parsed !== null && parsed > 0) {
                    onCommit(parsed);
                } else {
                    event.target.value = formatLength(value, units);
                }
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
            className="w-28 rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-[0.75rem] text-chrome-fg outline-none focus:border-sand"
        />
    );
}

type SegmentedControlProps<T extends string> = {
    value: T;
    options: { id: T; label: string }[];
    onChange: (value: T) => void;
};

function SegmentedControl<T extends string>({
    value,
    options,
    onChange,
}: SegmentedControlProps<T>) {
    return (
        <div className="flex shrink-0 overflow-hidden rounded-sm border border-chrome-border">
            {options.map((option) => (
                <button
                    key={option.id}
                    type="button"
                    onClick={() => onChange(option.id)}
                    className={cn(
                        'px-2 py-1 text-[0.72rem] transition-colors',
                        option.id === value
                            ? 'bg-sand/20 text-sand'
                            : 'bg-chrome-sunken text-chrome-muted hover:text-chrome-fg',
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

type ToggleChipProps = {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    hint?: string;
};

function ToggleChip({ active, onClick, icon, label, hint }: ToggleChipProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={hint}
            className={cn(
                'flex items-center gap-1 rounded-sm border px-2 py-1 text-[0.72rem] transition-colors',
                active
                    ? 'border-sand/50 bg-sand/20 text-sand'
                    : 'border-chrome-border text-chrome-muted hover:text-chrome-fg',
            )}
        >
            {icon}
            {label}
        </button>
    );
}

type NumberInputProps = {
    value: number;
    min: number;
    max: number;
    suffix?: string;
    onCommit: (value: number) => void;
};

/** A plain numeric field for counts and angles, clamped to its range. */
function NumberInput({ value, min, max, suffix, onCommit }: NumberInputProps) {
    return (
        <span className="flex items-center gap-1">
            <input
                key={value}
                defaultValue={value}
                inputMode="numeric"
                onBlur={(event) => {
                    const parsed = Number.parseFloat(event.target.value);

                    if (Number.isFinite(parsed)) {
                        onCommit(Math.min(Math.max(parsed, min), max));
                    } else {
                        event.target.value = String(value);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.currentTarget.blur();
                    }
                }}
                className="w-16 rounded-sm border border-chrome-border bg-chrome-sunken px-1.5 py-1 text-[0.75rem] text-chrome-fg tabular-nums outline-none focus:border-sand"
            />
            {suffix && <span className="text-chrome-muted">{suffix}</span>}
        </span>
    );
}
