import { Head, Link, router } from '@inertiajs/react';
import {
    ArrowLeft,
    Box,
    Circle,
    Copy,
    PencilRuler,
    PenTool,
    Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DesignTerminal } from '@/components/library/design-terminal';
import type { AiConnectionSummary } from '@/components/library/design-terminal';
import { DesignerViewport } from '@/components/library/designer-viewport';
import { SketchPad } from '@/components/library/sketch-pad';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    compileScene,
    DEFAULT_PART_COLOUR,
    ITEM_PRESETS,
    itemSnapshot,
    MAX_PARTS,
    newPart,
    newSketchPart,
    PART_COLOURS,
    payloadFromMesh,
    resizePart,
} from '@/lib/cad/library';
import type { ItemPart } from '@/lib/cad/library';
import { createId } from '@/lib/cad/model';
import { cn } from '@/lib/utils';
import { index, store, update } from '@/routes/library';

type DesignerPageProps = {
    /** Set when a designed item was reopened from the shelf. */
    editing: {
        id: number;
        name: string;
        category: string;
        parts: ItemPart[];
    } | null;
    /** The AI accounts this user has connected — never their keys. */
    connections: AiConnectionSummary[];
    /** True when Claude Code on this machine can answer in the page. */
    claudeCodeReady: boolean;
};

/**
 * The item designer: build a couch, a table, a lamp — anything — out of
 * boxes and cylinders, in millimetres, and put it on the library shelf.
 */
export default function Designer({
    editing,
    connections,
    claudeCodeReady,
}: DesignerPageProps) {
    const [parts, setParts] = useState<ItemPart[]>(editing?.parts ?? []);
    const [chosenId, setChosenId] = useState<string | null>(
        editing?.parts[0]?.id ?? null,
    );
    const [name, setName] = useState(editing?.name ?? '');
    const [category, setCategory] = useState(editing?.category ?? 'Furniture');
    const [saving, setSaving] = useState(false);
    const [sketching, setSketching] = useState(false);

    const scene = useMemo(
        () => compileScene(name || 'Item', parts),
        [name, parts],
    );
    const mesh = scene.mesh;
    const snapshot = useMemo(
        () => itemSnapshot(mesh.vertices, scene.pieces),
        [mesh, scene.pieces],
    );

    const chosen = parts.find((part) => part.id === chosenId) ?? null;

    function patchPart(id: string, values: Partial<ItemPart>) {
        setParts((current) =>
            current.map((part) =>
                part.id === id ? { ...part, ...values } : part,
            ),
        );
    }

    /** An AI draft replaces the board; its names fill blanks, never overwrite. */
    function adoptDraft(
        drafted: ItemPart[],
        draftName: string | null,
        draftCategory: string | null,
    ) {
        const loaded = drafted.map((part) => ({
            ...part,
            id: createId('part'),
        }));

        setParts(loaded);
        setChosenId(loaded[0]?.id ?? null);

        if (name.trim() === '' && draftName) {
            setName(draftName);
        }

        if (category.trim() === '' && draftCategory) {
            setCategory(draftCategory);
        }
    }

    /** Turn a drawn outline into a part, exactly as tall as it is told. */
    function addSketch(outline: { x: number; y: number }[]) {
        if (parts.length >= MAX_PARTS) {
            return;
        }

        const part = { ...newSketchPart(outline), height: 400 };

        setParts((current) => [...current, part]);
        setChosenId(part.id);
    }

    /** Resize through resizePart so a sketch outline scales with its numbers. */
    function sizePart(id: string, values: { width?: number; depth?: number }) {
        setParts((current) =>
            current.map((part) =>
                part.id === id ? resizePart(part, values) : part,
            ),
        );
    }

    function addPart(shape: 'box' | 'cylinder') {
        if (parts.length >= MAX_PARTS) {
            return;
        }

        const part = newPart(shape);

        setParts((current) => [...current, part]);
        setChosenId(part.id);
    }

    function duplicateChosen() {
        if (!chosen || parts.length >= MAX_PARTS) {
            return;
        }

        const copy: ItemPart = {
            ...chosen,
            id: createId('part'),
            x: chosen.x + 100,
            y: chosen.y + 100,
        };

        setParts((current) => [...current, copy]);
        setChosenId(copy.id);
    }

    function removeChosen() {
        if (!chosen) {
            return;
        }

        setParts((current) => current.filter((part) => part.id !== chosen.id));
        setChosenId(null);
    }

    function loadPreset(presetName: string) {
        const preset = ITEM_PRESETS.find((item) => item.name === presetName);

        if (!preset) {
            return;
        }

        const loaded = preset.parts.map((part) => ({
            ...part,
            id: createId('part'),
        }));

        setParts(loaded);
        setChosenId(loaded[0]?.id ?? null);

        if (name.trim() === '') {
            setName(preset.name);
            setCategory(preset.category);
        }
    }

    /** Compile, photograph, and put it on the shelf. */
    function save() {
        if (mesh.triangleCount === 0 || name.trim() === '' || saving) {
            return;
        }

        const item = {
            name: name.trim(),
            category: category.trim() || 'Furniture',
            kind: 'designed',
            thumbnail: snapshot,
            payload: payloadFromMesh(mesh, parts),
        };

        setSaving(true);

        const done = {
            onFinish: () => setSaving(false),
        };

        if (editing) {
            router.put(update(editing.id), item, done);
        } else {
            router.post(store(), item, done);
        }
    }

    return (
        <>
            <Head title={editing ? `Edit ${editing.name}` : 'Design an item'} />

            <div className="flex h-full flex-1 flex-col gap-6 p-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
                    <div>
                        <Link
                            href={index()}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <ArrowLeft className="size-3.5" />
                            Back to the library
                        </Link>
                        <h1 className="mt-2 flex items-center gap-2 text-2xl font-light tracking-tight">
                            <PencilRuler className="size-5 text-sand" />
                            {editing
                                ? `Edit ${editing.name}`
                                : 'Design an item'}
                        </h1>
                        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                            Build it out of boxes and cylinders, in millimetres.
                            Start from a preset and change every number, or
                            start empty.
                        </p>
                    </div>

                    <div className="flex items-end gap-3">
                        <div className="grid gap-1.5">
                            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                Name
                            </Label>
                            <Input
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                placeholder="Two-seat couch"
                                className="w-48"
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                Category
                            </Label>
                            <Input
                                value={category}
                                onChange={(event) =>
                                    setCategory(event.target.value)
                                }
                                className="w-36"
                            />
                        </div>
                        <Button
                            onClick={save}
                            disabled={
                                saving ||
                                mesh.triangleCount === 0 ||
                                name.trim() === ''
                            }
                        >
                            {saving
                                ? 'Saving…'
                                : editing
                                  ? 'Save changes'
                                  : 'Put it on the shelf'}
                        </Button>
                    </div>
                </header>

                <DesignTerminal
                    connections={connections}
                    claudeCodeReady={claudeCodeReady}
                    parts={parts}
                    onDraft={adoptDraft}
                />

                <div className="flex flex-wrap items-center gap-2">
                    <span className="ax-eyebrow text-muted-foreground">
                        Start from
                    </span>
                    {ITEM_PRESETS.map((preset) => (
                        <button
                            key={preset.name}
                            type="button"
                            onClick={() => loadPreset(preset.name)}
                            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                        >
                            {preset.name}
                        </button>
                    ))}
                </div>

                <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                    {/* ------------------------------------------ the parts */}
                    <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                            <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                                Parts · {parts.length}
                            </p>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addPart('box')}
                                >
                                    <Box className="size-3.5" />
                                    Box
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => addPart('cylinder')}
                                >
                                    <Circle className="size-3.5" />
                                    Cylinder
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSketching(true)}
                                    title="Draw an outline with a pencil, a finger or the mouse"
                                >
                                    <PenTool className="size-3.5" />
                                    Draw
                                </Button>
                            </div>
                        </div>

                        <div className="min-h-32 flex-1 overflow-y-auto p-2">
                            {parts.length === 0 ? (
                                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                                    No parts yet. Add a box, or start from a
                                    preset above.
                                </p>
                            ) : (
                                <ul className="space-y-1">
                                    {parts.map((part) => (
                                        <li key={part.id}>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setChosenId(part.id)
                                                }
                                                className={cn(
                                                    'flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors',
                                                    part.id === chosenId
                                                        ? 'border-ring bg-accent'
                                                        : 'border-transparent hover:bg-accent/40',
                                                )}
                                            >
                                                <span className="flex items-center gap-2 truncate">
                                                    {part.shape === 'box' ? (
                                                        <Box className="size-3.5 shrink-0 text-sand" />
                                                    ) : part.shape ===
                                                      'cylinder' ? (
                                                        <Circle className="size-3.5 shrink-0 text-sand" />
                                                    ) : (
                                                        <PenTool className="size-3.5 shrink-0 text-sand" />
                                                    )}
                                                    {part.name}
                                                </span>
                                                <span className="shrink-0 text-[0.68rem] text-muted-foreground tabular-nums">
                                                    {Math.round(part.width)} ×{' '}
                                                    {Math.round(part.depth)} ×{' '}
                                                    {Math.round(part.height)}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {chosen && (
                            <div className="border-t border-border p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <Input
                                        value={chosen.name}
                                        onChange={(event) =>
                                            patchPart(chosen.id, {
                                                name: event.target.value,
                                            })
                                        }
                                        className="h-8"
                                    />
                                    <div className="flex shrink-0 items-center gap-0.5">
                                        <button
                                            type="button"
                                            aria-label="Duplicate part"
                                            title="Duplicate"
                                            onClick={duplicateChosen}
                                            className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                        >
                                            <Copy className="size-4" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label="Remove part"
                                            title="Remove"
                                            onClick={removeChosen}
                                            className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                        >
                                            <Trash2 className="size-4" />
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2.5">
                                    <Dimension
                                        label={
                                            chosen.shape === 'cylinder'
                                                ? 'Width Ø'
                                                : 'Width'
                                        }
                                        value={chosen.width}
                                        min={1}
                                        onCommit={(width) =>
                                            sizePart(chosen.id, { width })
                                        }
                                    />
                                    <Dimension
                                        label={
                                            chosen.shape === 'cylinder'
                                                ? 'Depth Ø'
                                                : 'Depth'
                                        }
                                        value={chosen.depth}
                                        min={1}
                                        onCommit={(depth) =>
                                            sizePart(chosen.id, { depth })
                                        }
                                    />
                                    <Dimension
                                        label="Height"
                                        value={chosen.height}
                                        min={1}
                                        onCommit={(height) =>
                                            patchPart(chosen.id, { height })
                                        }
                                    />
                                    <Dimension
                                        label="Across (X)"
                                        value={chosen.x}
                                        onCommit={(x) =>
                                            patchPart(chosen.id, { x })
                                        }
                                    />
                                    <Dimension
                                        label="Deep (Y)"
                                        value={chosen.y}
                                        onCommit={(y) =>
                                            patchPart(chosen.id, { y })
                                        }
                                    />
                                    <Dimension
                                        label="Up (Z)"
                                        value={chosen.z}
                                        onCommit={(z) =>
                                            patchPart(chosen.id, { z })
                                        }
                                    />
                                    <Dimension
                                        label="Rotation °"
                                        value={chosen.rotation}
                                        onCommit={(rotation) =>
                                            patchPart(chosen.id, { rotation })
                                        }
                                    />
                                </div>

                                <div className="mt-3">
                                    <Label className="text-[0.62rem] tracking-wide text-muted-foreground uppercase">
                                        Material
                                    </Label>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                        {PART_COLOURS.map((material) => {
                                            const wearing =
                                                (chosen.colour ??
                                                    DEFAULT_PART_COLOUR) ===
                                                material.value;

                                            return (
                                                <button
                                                    key={material.value}
                                                    type="button"
                                                    title={material.name}
                                                    aria-label={material.name}
                                                    aria-pressed={wearing}
                                                    onClick={() =>
                                                        patchPart(chosen.id, {
                                                            colour: material.value,
                                                        })
                                                    }
                                                    className={cn(
                                                        'size-6 rounded-full border transition-transform',
                                                        wearing
                                                            ? 'scale-110 border-ring ring-2 ring-ring/40'
                                                            : 'border-border hover:scale-110',
                                                    )}
                                                    style={{
                                                        background:
                                                            material.value,
                                                    }}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>

                                <p className="mt-3 text-[0.68rem] text-muted-foreground">
                                    Millimetres, measured from the item's
                                    centre; Z is the part's underside.
                                </p>
                            </div>
                        )}
                    </section>

                    {/* ---------------------------------------- the preview */}
                    <section className="flex min-h-72 flex-col rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                            <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                                Preview
                            </p>
                            {mesh.triangleCount > 0 && (
                                <p className="text-[0.7rem] text-muted-foreground tabular-nums">
                                    {Math.round(mesh.size.x)} ×{' '}
                                    {Math.round(mesh.size.y)} ×{' '}
                                    {Math.round(mesh.size.z)} mm ·{' '}
                                    {mesh.triangleCount.toLocaleString('en-CA')}{' '}
                                    triangles
                                </p>
                            )}
                        </div>

                        <div className="relative flex flex-1 items-center justify-center bg-gradient-to-b from-paper to-paper-warm">
                            {mesh.triangleCount === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    The item appears here as you build it.
                                </p>
                            ) : (
                                <DesignerViewport
                                    scene={scene}
                                    selectedId={chosenId}
                                    onSelect={setChosenId}
                                />
                            )}
                        </div>
                    </section>
                </div>
            </div>

            <SketchPad
                open={sketching}
                onOpenChange={setSketching}
                onAccept={addSketch}
            />
        </>
    );
}

/** A millimetre field that commits on blur or Enter, like the palette's. */
function Dimension({
    label,
    value,
    min,
    onCommit,
}: {
    label: string;
    value: number;
    min?: number;
    onCommit: (value: number) => void;
}) {
    return (
        <div className="grid gap-1">
            <Label className="text-[0.62rem] tracking-wide text-muted-foreground uppercase">
                {label}
            </Label>
            <input
                key={value}
                type="number"
                defaultValue={value}
                onBlur={(event) => {
                    const parsed = Number(event.target.value);

                    if (
                        Number.isFinite(parsed) &&
                        (min === undefined || parsed >= min)
                    ) {
                        onCommit(parsed);
                    } else {
                        event.target.value = String(value);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.currentTarget.blur();
                    }
                }}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring"
            />
        </div>
    );
}

Designer.layout = {
    breadcrumbs: [
        {
            title: 'Library',
            href: index(),
        },
        {
            title: 'Designer',
            href: '',
        },
    ],
};
