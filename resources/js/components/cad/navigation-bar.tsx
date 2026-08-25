import {
    Frame,
    Hand,
    Maximize,
    Minus,
    MousePointer2,
    Plus,
    ZoomIn,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type NavigationBarProps = {
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomFit: () => void;
    onZoomSelection?: (() => void) | null;
};

/**
 * The floating navigation bar Revit docks at the edge of the drawing area,
 * with the zoom commands behind a flyout.
 */
export function NavigationBar({
    onZoomIn,
    onZoomOut,
    onZoomFit,
    onZoomSelection = null,
}: NavigationBarProps) {
    const [flyoutOpen, setFlyoutOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!flyoutOpen) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setFlyoutOpen(false);
            }
        };

        window.addEventListener('pointerdown', onPointerDown);

        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, [flyoutOpen]);

    const run = (action: () => void) => () => {
        setFlyoutOpen(false);
        action();
    };

    const flyout: { icon: LucideIcon; label: string; onSelect: () => void }[] =
        [
            { icon: Plus, label: 'Zoom In', onSelect: run(onZoomIn) },
            { icon: Minus, label: 'Zoom Out', onSelect: run(onZoomOut) },
            {
                icon: Maximize,
                label: 'Zoom to Fit (ZF)',
                onSelect: run(onZoomFit),
            },
            ...(onZoomSelection
                ? [
                      {
                          icon: Frame,
                          label: 'Zoom to Selection',
                          onSelect: run(onZoomSelection),
                      },
                  ]
                : []),
        ];

    return (
        <div
            ref={containerRef}
            className="flex flex-col overflow-visible rounded-sm border border-chrome-border/60 bg-chrome/85 shadow-md backdrop-blur-sm"
        >
            <NavButton
                icon={MousePointer2}
                label="Modify (Esc)"
                onClick={run(() => undefined)}
            />
            <NavButton
                icon={Hand}
                label="Pan — drag with the middle mouse button"
                onClick={run(() => undefined)}
            />

            <div className="relative">
                <NavButton
                    icon={ZoomIn}
                    label="Zoom commands"
                    active={flyoutOpen}
                    onClick={() => setFlyoutOpen((previous) => !previous)}
                />

                {flyoutOpen && (
                    <div
                        role="menu"
                        className="absolute top-0 right-full mr-1 w-44 rounded-sm border border-chrome-border bg-chrome-raised py-1 shadow-xl"
                    >
                        {flyout.map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                role="menuitem"
                                onClick={item.onSelect}
                                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[0.75rem] text-chrome-fg transition-colors hover:bg-chrome/70"
                            >
                                <item.icon className="size-3.5 shrink-0 text-sand" />
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

type NavButtonProps = {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    active?: boolean;
};

function NavButton({
    icon: Icon,
    label,
    onClick,
    active = false,
}: NavButtonProps) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            className={cn(
                'p-1.5 transition-colors',
                active
                    ? 'bg-sand/20 text-sand'
                    : 'text-chrome-fg hover:bg-chrome-raised',
            )}
        >
            <Icon className="size-4 stroke-[1.5]" />
        </button>
    );
}
