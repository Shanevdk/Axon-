import { FileUp, Upload } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { parseDxf } from '@/lib/cad/exchange/dxf';
import type { DxfDrawing } from '@/lib/cad/exchange/dxf';
import {
    insertDocument,
    insertDxf,
    insertMesh,
    insertTypeLibrary,
    isCadDocument,
    isTypeLibrary,
} from '@/lib/cad/exchange/insert';
import type {
    DocumentInsertMode,
    TypeLibrary,
} from '@/lib/cad/exchange/insert';
import { MeshImportError, parseMesh } from '@/lib/cad/exchange/mesh-import';
import type { ImportedMesh } from '@/lib/cad/exchange/mesh-import';
import type { CadDocument } from '@/lib/cad/types';
import { cn } from '@/lib/utils';

type Payload =
    | { kind: 'dxf'; filename: string; drawing: DxfDrawing }
    | { kind: 'mesh'; filename: string; mesh: ImportedMesh }
    | { kind: 'types'; filename: string; library: TypeLibrary }
    | { kind: 'document'; filename: string; document: CadDocument };

type ImportDialogProps = {
    editor: CadEditor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/** Scale options offered when a file has no reliable unit information. */
const SCALES = [
    { value: 1, label: 'Millimetres' },
    { value: 10, label: 'Centimetres' },
    { value: 1000, label: 'Metres' },
    { value: 25.4, label: 'Inches' },
    { value: 304.8, label: 'Feet' },
];

export function ImportDialog({
    editor,
    open,
    onOpenChange,
}: ImportDialogProps) {
    const [payload, setPayload] = useState<Payload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);

    const [dxfAs, setDxfAs] = useState<'walls' | 'lines'>('lines');
    const [dxfLayers, setDxfLayers] = useState<string[]>([]);
    const [meshScale, setMeshScale] = useState(1);
    const [documentMode, setDocumentMode] =
        useState<DocumentInsertMode>('merge');

    const reset = () => {
        setPayload(null);
        setError(null);
        setDxfLayers([]);
        setMeshScale(1);
    };

    const accept = async (file: File) => {
        setError(null);

        try {
            const lower = file.name.toLowerCase();

            if (lower.endsWith('.dxf')) {
                const drawing = parseDxf(await file.text());

                if (drawing.polylines.length === 0) {
                    throw new Error('No lines or polylines found in that DXF.');
                }

                setPayload({ kind: 'dxf', filename: file.name, drawing });
                setDxfLayers(drawing.layers);

                return;
            }

            if (lower.endsWith('.stl') || lower.endsWith('.obj')) {
                setPayload({
                    kind: 'mesh',
                    filename: file.name,
                    mesh: parseMesh(file.name, await file.arrayBuffer()),
                });

                return;
            }

            if (lower.endsWith('.json')) {
                const parsed: unknown = JSON.parse(await file.text());

                if (isTypeLibrary(parsed)) {
                    setPayload({
                        kind: 'types',
                        filename: file.name,
                        library: parsed,
                    });

                    return;
                }

                if (isCadDocument(parsed)) {
                    setPayload({
                        kind: 'document',
                        filename: file.name,
                        document: parsed,
                    });

                    return;
                }

                throw new Error(
                    'That JSON is neither a model nor a type library.',
                );
            }

            throw new Error('Unsupported file. Use DXF, STL, OBJ or JSON.');
        } catch (thrown) {
            setPayload(null);
            setError(
                thrown instanceof MeshImportError || thrown instanceof Error
                    ? thrown.message
                    : 'That file could not be read.',
            );
        }
    };

    const insert = () => {
        if (!payload) {
            return;
        }

        const level = editor.level.id;

        editor.store.commit('Import', (current) => {
            switch (payload.kind) {
                case 'dxf':
                    return insertDxf(current, payload.drawing.polylines, {
                        levelId: level,
                        as: dxfAs,
                        layers: dxfLayers,
                        wallTypeId: editor.wallTypeId,
                        wallHeight: editor.wallHeight,
                        locationLine: editor.locationLine,
                    }).document;
                case 'mesh':
                    return insertMesh(current, payload.mesh, {
                        levelId: level,
                        at: editor.camera.center,
                        scale: meshScale,
                    }).document;
                case 'types':
                    return insertTypeLibrary(current, payload.library).document;
                case 'document':
                    return insertDocument(
                        current,
                        payload.document,
                        documentMode,
                        level,
                    ).document;
            }
        });

        editor.setStatus(`Imported ${payload.filename}`);
        reset();
        onOpenChange(false);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    reset();
                }

                onOpenChange(next);
            }}
        >
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Import</DialogTitle>
                    <DialogDescription>
                        CAD drawings, 3D meshes, type libraries or another Axon
                        model.
                    </DialogDescription>
                </DialogHeader>

                <label
                    onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);

                        const file = event.dataTransfer.files[0];

                        if (file) {
                            void accept(file);
                        }
                    }}
                    className={cn(
                        'flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-8 text-center transition-colors',
                        dragging
                            ? 'border-sand bg-accent'
                            : 'border-border hover:border-sand/60 hover:bg-accent/40',
                    )}
                >
                    <input
                        type="file"
                        accept=".dxf,.stl,.obj,.json"
                        className="sr-only"
                        onChange={(event) => {
                            const file = event.target.files?.[0];

                            if (file) {
                                void accept(file);
                            }

                            event.target.value = '';
                        }}
                    />
                    <FileUp className="size-6 text-sand" />
                    <p className="mt-2 text-sm font-medium">
                        {payload
                            ? payload.filename
                            : 'Drop a file, or click to choose'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        DXF · STL · OBJ · Axon model or type library
                    </p>
                </label>

                {error && <p className="text-sm text-destructive">{error}</p>}

                {payload?.kind === 'dxf' && (
                    <section className="space-y-4">
                        <p className="text-xs text-muted-foreground">
                            {payload.drawing.polylines.length} lines and
                            polylines
                            {payload.drawing.unitScale !== 1 &&
                                ` · scaled ×${payload.drawing.unitScale} from the drawing units`}
                        </p>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                    Bring in as
                                </Label>
                                {(
                                    [
                                        {
                                            id: 'lines',
                                            label: 'Reference lines',
                                            hint: 'Trace over them by hand',
                                        },
                                        {
                                            id: 'walls',
                                            label: 'Walls',
                                            hint: `${editor.wallTypeId}, ${editor.wallHeight} mm high`,
                                        },
                                    ] as const
                                ).map((option) => (
                                    <label
                                        key={option.id}
                                        className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 hover:bg-accent/50"
                                    >
                                        <input
                                            type="radio"
                                            name="dxf-as"
                                            checked={dxfAs === option.id}
                                            onChange={() => setDxfAs(option.id)}
                                            className="mt-1 accent-sand"
                                        />
                                        <span>
                                            <span className="block text-sm">
                                                {option.label}
                                            </span>
                                            <span className="block text-xs text-muted-foreground">
                                                {option.hint}
                                            </span>
                                        </span>
                                    </label>
                                ))}
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                    Layers
                                </Label>
                                <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                                    {payload.drawing.layers.map((layer) => (
                                        <label
                                            key={layer}
                                            className="flex cursor-pointer items-center gap-2 text-sm"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={dxfLayers.includes(
                                                    layer,
                                                )}
                                                onChange={(event) =>
                                                    setDxfLayers((previous) =>
                                                        event.target.checked
                                                            ? [
                                                                  ...previous,
                                                                  layer,
                                                              ]
                                                            : previous.filter(
                                                                  (item) =>
                                                                      item !==
                                                                      layer,
                                                              ),
                                                    )
                                                }
                                                className="accent-sand"
                                            />
                                            <span className="truncate">
                                                {layer}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>
                )}

                {payload?.kind === 'mesh' && (
                    <section className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                            {payload.mesh.triangleCount.toLocaleString('en-CA')}{' '}
                            triangles · {Math.round(payload.mesh.size.x)} ×{' '}
                            {Math.round(payload.mesh.size.y)} ×{' '}
                            {Math.round(payload.mesh.size.z)} in file units
                        </p>

                        <div className="space-y-2">
                            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                File units
                            </Label>
                            <div className="flex flex-wrap gap-2">
                                {SCALES.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() =>
                                            setMeshScale(option.value)
                                        }
                                        className={cn(
                                            'rounded-sm border px-2.5 py-1 text-xs transition-colors',
                                            meshScale === option.value
                                                ? 'border-sand bg-accent'
                                                : 'border-border hover:border-sand/60',
                                        )}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Placed at{' '}
                                {Math.round(payload.mesh.size.x * meshScale)} ×{' '}
                                {Math.round(payload.mesh.size.y * meshScale)} ×{' '}
                                {Math.round(payload.mesh.size.z * meshScale)} mm
                                on {editor.level.name}.
                            </p>
                        </div>
                    </section>
                )}

                {payload?.kind === 'types' && (
                    <p className="text-sm text-muted-foreground">
                        {(payload.library.wallTypes?.length ?? 0) +
                            (payload.library.doorTypes?.length ?? 0) +
                            (payload.library.windowTypes?.length ?? 0)}{' '}
                        types in this library. Anything already in the project
                        is skipped.
                    </p>
                )}

                {payload?.kind === 'document' && (
                    <section className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                            {payload.document.elements.length} elements across{' '}
                            {payload.document.levels.length} levels.
                        </p>
                        {(
                            [
                                {
                                    id: 'merge',
                                    label: 'Merge onto this level',
                                    hint: 'Keeps the current model and adds to it',
                                },
                                {
                                    id: 'replace',
                                    label: 'Replace the model',
                                    hint: 'Discards everything currently drawn',
                                },
                            ] as const
                        ).map((option) => (
                            <label
                                key={option.id}
                                className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 hover:bg-accent/50"
                            >
                                <input
                                    type="radio"
                                    name="document-mode"
                                    checked={documentMode === option.id}
                                    onChange={() => setDocumentMode(option.id)}
                                    className="mt-1 accent-sand"
                                />
                                <span>
                                    <span className="block text-sm">
                                        {option.label}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {option.hint}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </section>
                )}

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button type="button" onClick={insert} disabled={!payload}>
                        <Upload className="size-4" />
                        Insert
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
