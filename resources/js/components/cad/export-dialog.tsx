import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
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
import {
    buildExport,
    describeExtents,
    downloadExport,
    EXPORT_FORMATS,
    EXPORT_SCOPES,
    formatById,
} from '@/lib/cad/exchange';
import type { ExportFormatId, ExportScopeId, UpAxis } from '@/lib/cad/exchange';
import { cn } from '@/lib/utils';

type ExportDialogProps = {
    editor: CadEditor;
    projectName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function ExportDialog({
    editor,
    projectName,
    open,
    onOpenChange,
}: ExportDialogProps) {
    const [format, setFormat] = useState<ExportFormatId>('step');
    const [scope, setScope] = useState<ExportScopeId>('model');
    const [upAxis, setUpAxis] = useState<UpAxis>('z');

    const definition = formatById(format);
    // DXF is a plan drawing, so it is always the level that is open.
    const effectiveScope: ExportScopeId =
        definition.dimension === '3d' ? scope : 'model';

    const request = useMemo(
        () => ({
            document: editor.document,
            format,
            scope: effectiveScope,
            levelId: editor.level.id,
            selection: editor.selection,
            name: projectName,
            upAxis,
        }),
        [
            editor.document,
            editor.level.id,
            editor.selection,
            effectiveScope,
            format,
            projectName,
            upAxis,
        ],
    );

    const preview = useMemo(() => {
        if (!open || definition.dimension !== '3d') {
            return null;
        }

        try {
            return { extents: describeExtents(request) };
        } catch {
            return null;
        }
    }, [open, definition.dimension, request]);

    const selectionEmpty =
        effectiveScope === 'selection' && editor.selection.length === 0;

    const run = () => {
        const result = buildExport(request);

        downloadExport(result);
        editor.setStatus(
            `Exported ${result.files.map((file) => file.filename).join(' and ')}`,
        );
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Export model</DialogTitle>
                    <DialogDescription>
                        Everything is written in millimetres, straight from the
                        model geometry.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <section className="space-y-2">
                        <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                            Format
                        </Label>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {EXPORT_FORMATS.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setFormat(option.id)}
                                    className={cn(
                                        'rounded-md border p-3 text-left transition-colors',
                                        option.id === format
                                            ? 'border-sand bg-accent'
                                            : 'border-border hover:border-sand/60 hover:bg-accent/50',
                                    )}
                                >
                                    <div className="flex items-baseline justify-between gap-2">
                                        <p className="text-sm font-medium">
                                            {option.label}
                                        </p>
                                        <span className="font-mono text-[0.65rem] text-muted-foreground">
                                            .{option.extension}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {option.description}
                                    </p>
                                </button>
                            ))}
                        </div>
                    </section>

                    {definition.dimension === '3d' && (
                        <section className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                    Scope
                                </Label>
                                <div className="space-y-1">
                                    {EXPORT_SCOPES.map((option) => (
                                        <label
                                            key={option.id}
                                            className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 hover:bg-accent/50"
                                        >
                                            <input
                                                type="radio"
                                                name="export-scope"
                                                checked={scope === option.id}
                                                onChange={() =>
                                                    setScope(option.id)
                                                }
                                                className="mt-1 accent-sand"
                                            />
                                            <span>
                                                <span className="block text-sm">
                                                    {option.label}
                                                    {option.id ===
                                                        'selection' && (
                                                        <span className="ml-1 text-xs text-muted-foreground">
                                                            (
                                                            {
                                                                editor.selection
                                                                    .length
                                                            }
                                                            )
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="block text-xs text-muted-foreground">
                                                    {option.description}
                                                </span>
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                    Up axis
                                </Label>
                                <div className="space-y-1">
                                    {(
                                        [
                                            {
                                                id: 'z',
                                                label: 'Z up',
                                                hint: 'CAD convention',
                                            },
                                            {
                                                id: 'y',
                                                label: 'Y up',
                                                hint: 'Blender, three.js, game engines',
                                            },
                                        ] as const
                                    ).map((option) => (
                                        <label
                                            key={option.id}
                                            className="flex cursor-pointer items-start gap-2 rounded-sm px-1 py-1 hover:bg-accent/50"
                                        >
                                            <input
                                                type="radio"
                                                name="export-up"
                                                checked={upAxis === option.id}
                                                onChange={() =>
                                                    setUpAxis(option.id)
                                                }
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
                            </div>
                        </section>
                    )}

                    {definition.dimension === '2d' && (
                        <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                            A DXF is the plan of the open view. Walls, openings,
                            rooms, dimensions and text go out on separate
                            layers, drawn from{' '}
                            <span className="text-foreground">
                                {editor.level.name}
                            </span>
                            .
                        </p>
                    )}

                    {preview?.extents && (
                        <p className="text-xs text-muted-foreground">
                            Model extents {preview.extents}
                        </p>
                    )}

                    {selectionEmpty && (
                        <p className="text-xs text-destructive">
                            Nothing is selected, so this export would be empty.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={run}
                        disabled={selectionEmpty}
                    >
                        <Download className="size-4" />
                        Export
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
