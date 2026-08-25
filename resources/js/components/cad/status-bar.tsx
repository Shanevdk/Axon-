import { EyeOff, Filter, MousePointer2 } from 'lucide-react';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { elementCategory, totalWallLength } from '@/lib/cad/model';
import { SNAP_LABELS } from '@/lib/cad/snapping';
import type { Point, SnapResult } from '@/lib/cad/types';
import { formatDimension, formatLength } from '@/lib/cad/units';
import { cn } from '@/lib/utils';

type StatusBarProps = {
    editor: CadEditor;
    cursor: Point | null;
    snap: SnapResult | null;
};

export function StatusBar({ editor, cursor, snap }: StatusBarProps) {
    const { document, level, selection, status, units } = {
        ...editor,
        units: editor.document.units,
    };

    const selectionLabel =
        selection.length === 0
            ? 'Nothing selected'
            : selection.length === 1
              ? categoryOf(editor)
              : `${selection.length} elements`;

    return (
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-chrome-border bg-chrome-sunken px-3 text-[0.7rem] text-chrome-muted">
            <span className="min-w-0 flex-1 truncate text-chrome-fg">
                {status}
            </span>

            {snap && snap.kind !== 'free' && (
                <span className="hidden text-sand md:inline">
                    {SNAP_LABELS[snap.kind]}
                </span>
            )}

            {cursor && (
                <span className="hidden tabular-nums lg:inline">
                    X {formatDimension(cursor.x, units)} · Y{' '}
                    {formatDimension(cursor.y, units)}
                </span>
            )}

            <span className="hidden md:inline">
                Walls {formatLength(totalWallLength(document, level.id), units)}
            </span>

            {editor.hidden.size > 0 && (
                <button
                    type="button"
                    onClick={editor.resetTemporaryHide}
                    title="Reset temporary hide/isolate"
                    className="flex items-center gap-1 rounded-sm bg-ember/15 px-1.5 py-0.5 text-ember transition-colors hover:bg-ember/25"
                >
                    <EyeOff className="size-3" />
                    {editor.hidden.size} hidden
                </button>
            )}

            {/* Revit's selection readout: filter icon plus the count. */}
            <span
                className={cn(
                    'flex items-center gap-1.5',
                    selection.length > 0 && 'text-sand',
                )}
            >
                <Filter className="size-3" />
                {selectionLabel}
                {selection.length > 0 && `: ${selection.length}`}
            </span>

            <span
                className="hidden items-center gap-1 sm:flex"
                title="Press & Drag moves a selected element without clicking first"
            >
                <MousePointer2 className="size-3" />
                Press &amp; Drag
            </span>

            <span className="hidden sm:inline">{level.name}</span>

            <span className="tabular-nums">
                {units === 'imperial' ? 'ft-in' : 'mm'}
            </span>
        </footer>
    );
}

function categoryOf(editor: CadEditor): string {
    const element = editor.document.elements.find(
        (item) => item.id === editor.selection[0],
    );

    return element ? elementCategory(element.kind) : '1 element';
}
