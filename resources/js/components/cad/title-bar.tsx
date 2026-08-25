import { Link, router } from '@inertiajs/react';
import {
    Box,
    ChevronDown,
    FileImage,
    FolderOpen,
    Info,
    Loader2,
    LogOut,
    Maximize,
    Redo2,
    Ruler,
    Save,
    Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import AppLogoIcon from '@/components/app-logo-icon';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SaveState } from '@/hooks/use-cad-editor';
import { cn } from '@/lib/utils';
import { index as projectsIndex } from '@/routes/projects';

type TitleBarProps = {
    projectName: string;
    projectNumber: string | null;
    viewName: string;
    saveState: SaveState;
    isDirty: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onSave: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onZoomFit: () => void;
    onOpenThreeD: () => void;
    onMeasure: () => void;
    onExportImage: () => void;
    onProjectInfo: () => void;
};

export function TitleBar({
    projectName,
    projectNumber,
    viewName,
    saveState,
    isDirty,
    canUndo,
    canRedo,
    onSave,
    onUndo,
    onRedo,
    onZoomFit,
    onOpenThreeD,
    onMeasure,
    onExportImage,
    onProjectInfo,
}: TitleBarProps) {
    return (
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-chrome-border bg-chrome-sunken px-3 text-chrome-fg">
            <AppMenu
                onSave={onSave}
                onExportImage={onExportImage}
                onProjectInfo={onProjectInfo}
            />

            <div className="h-5 w-px bg-chrome-border" />

            <div className="flex items-center gap-0.5">
                <QuickAction
                    icon={Save}
                    label="Save (Ctrl+S)"
                    onClick={onSave}
                />
                <QuickAction
                    icon={Undo2}
                    label="Undo (Ctrl+Z)"
                    onClick={onUndo}
                    disabled={!canUndo}
                />
                <QuickAction
                    icon={Redo2}
                    label="Redo (Ctrl+Y)"
                    onClick={onRedo}
                    disabled={!canRedo}
                />
                <div className="mx-1 h-5 w-px bg-chrome-border" />
                <QuickAction
                    icon={Maximize}
                    label="Zoom to Fit (ZF)"
                    onClick={onZoomFit}
                />
                <QuickAction
                    icon={Box}
                    label="Default 3D View"
                    onClick={onOpenThreeD}
                />
                <QuickAction
                    icon={Ruler}
                    label="Measure (MS)"
                    onClick={onMeasure}
                />
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-sm">
                <span className="truncate font-medium">
                    {projectNumber ? `${projectNumber} — ` : ''}
                    {projectName}
                </span>
                <span className="text-chrome-muted">·</span>
                <span className="truncate text-chrome-muted">{viewName}</span>
            </div>

            <SaveIndicator saveState={saveState} isDirty={isDirty} />
        </header>
    );
}

function SaveIndicator({
    saveState,
    isDirty,
}: {
    saveState: SaveState;
    isDirty: boolean;
}) {
    if (saveState === 'saving') {
        return (
            <span className="flex items-center gap-1.5 text-xs text-chrome-muted">
                <Loader2 className="size-3.5 animate-spin" />
                Saving
            </span>
        );
    }

    if (saveState === 'error') {
        return (
            <span className="text-xs text-destructive">
                Save failed — retrying
            </span>
        );
    }

    return (
        <span
            className={cn(
                'flex items-center gap-1.5 text-xs',
                isDirty ? 'text-chrome-muted' : 'text-sand',
            )}
        >
            <span
                className={cn(
                    'size-1.5 rounded-full',
                    isDirty ? 'bg-chrome-muted' : 'bg-sand',
                )}
            />
            {isDirty ? 'Unsaved changes' : 'All changes saved'}
        </span>
    );
}

type QuickActionProps = {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    disabled?: boolean;
};

function QuickAction({
    icon: Icon,
    label,
    onClick,
    disabled = false,
}: QuickActionProps) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    onClick={onClick}
                    disabled={disabled}
                    aria-label={label}
                    className="rounded-sm p-1.5 text-chrome-fg transition-colors hover:bg-chrome/70 disabled:cursor-not-allowed disabled:opacity-35"
                >
                    <Icon className="size-4 stroke-[1.6]" />
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
    );
}

type AppMenuProps = {
    onSave: () => void;
    onExportImage: () => void;
    onProjectInfo: () => void;
};

/**
 * The application menu behind the brand button, the way Revit keeps file
 * commands behind its big R.
 */
function AppMenu({ onSave, onExportImage, onProjectInfo }: AppMenuProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        window.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('keydown', onKeyDown);

        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const run = (action: () => void) => () => {
        setOpen(false);
        action();
    };

    const items: {
        icon: LucideIcon;
        label: string;
        detail: string;
        onSelect: () => void;
    }[] = [
        {
            icon: Save,
            label: 'Save',
            detail: 'Save the model (Ctrl+S)',
            onSelect: run(onSave),
        },
        {
            icon: FileImage,
            label: 'Export Image',
            detail: 'Save the active view as a PNG',
            onSelect: run(onExportImage),
        },
        {
            icon: Info,
            label: 'Project Information',
            detail: 'Name, number, client and address',
            onSelect: run(onProjectInfo),
        },
        {
            icon: FolderOpen,
            label: 'Open Project…',
            detail: 'Back to the project list',
            onSelect: run(() => router.visit(projectsIndex().url)),
        },
    ];

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                aria-expanded={open}
                aria-haspopup="menu"
                className={cn(
                    'flex items-center gap-2 rounded-sm px-1.5 py-1 text-sand transition-colors',
                    open ? 'bg-chrome/80' : 'hover:bg-chrome/70',
                )}
            >
                <AppLogoIcon className="size-5" />
                <span className="hidden text-[0.72rem] font-semibold tracking-[0.2em] sm:inline">
                    AXON
                </span>
                <ChevronDown className="size-3.5 opacity-70" />
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute top-full left-0 z-40 mt-1 w-72 rounded-sm border border-chrome-border bg-chrome-raised py-1.5 shadow-xl"
                >
                    {items.map((item) => (
                        <button
                            key={item.label}
                            type="button"
                            role="menuitem"
                            onClick={item.onSelect}
                            className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-chrome/70"
                        >
                            <item.icon className="mt-0.5 size-4 shrink-0 text-sand" />
                            <span>
                                <span className="block text-[0.8rem] text-chrome-fg">
                                    {item.label}
                                </span>
                                <span className="block text-[0.68rem] text-chrome-muted">
                                    {item.detail}
                                </span>
                            </span>
                        </button>
                    ))}

                    <div className="my-1 h-px bg-chrome-border" />

                    <Link
                        href={projectsIndex()}
                        role="menuitem"
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-[0.8rem] text-chrome-fg transition-colors hover:bg-chrome/70"
                    >
                        <LogOut className="size-4 shrink-0 text-sand" />
                        Close Editor
                    </Link>
                </div>
            )}
        </div>
    );
}
