import { CircleCheck, OctagonAlert, TriangleAlert, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { reviewDocument } from '@/lib/cad/checkup';
import { cn } from '@/lib/utils';

type WarningsDialogProps = {
    editor: CadEditor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/**
 * Revit's Review Warnings dialog: everything the model quietly disagrees
 * with, each row selecting its culprits so they can be dealt with.
 */
export function WarningsDialog({
    editor,
    open,
    onOpenChange,
}: WarningsDialogProps) {
    const warnings = useMemo(
        () => (open ? reviewDocument(editor.document) : []),
        [editor.document, open],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <TriangleAlert className="size-4 text-sand" />
                        Warnings
                    </DialogTitle>
                    <DialogDescription>
                        Nothing here stops you drawing. Click a warning to
                        select the elements it is about.
                    </DialogDescription>
                </DialogHeader>

                {warnings.length === 0 ? (
                    <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                        <CircleCheck className="size-4 shrink-0" />
                        The model has nothing to complain about.
                    </p>
                ) : (
                    <ul className="max-h-96 space-y-1.5 overflow-y-auto">
                        {warnings.map((warning) => (
                            <li key={warning.id}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        editor.setSelection(warning.elementIds);
                                        editor.setStatus(
                                            `Selected ${warning.elementIds.length} element${warning.elementIds.length === 1 ? '' : 's'} from the warning`,
                                        );
                                        onOpenChange(false);
                                    }}
                                    className="flex w-full items-start gap-2.5 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-ring/60 hover:bg-accent/40"
                                >
                                    {warning.severity === 'error' ? (
                                        <OctagonAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                                    ) : (
                                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-sand" />
                                    )}
                                    <span
                                        className={cn(
                                            warning.severity === 'error' &&
                                                'font-medium',
                                        )}
                                    >
                                        {warning.message}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                <DialogFooter className="sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                        {warnings.length === 0
                            ? 'All clear'
                            : `${warnings.length} to look at`}
                    </p>
                    <div className="flex items-center gap-2">
                        {warnings.length > 0 && (
                            <Button
                                variant="outline"
                                onClick={() =>
                                    editor.runCommand('cleanUpModel')
                                }
                                title="Close open corners, square slipped walls, remove slivers, duplicates and orphans. The list re-checks itself."
                            >
                                <Wand2 className="size-4" />
                                Clean up automatically
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                        >
                            Close
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
