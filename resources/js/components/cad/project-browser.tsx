import {
    AppWindow,
    Box,
    BrickWall,
    Scissors,
    Search,
    ChevronDown,
    ChevronRight,
    Compass,
    DoorOpen,
    LayoutPanelTop,
    Mountain,
    Table2,
} from 'lucide-react';
import { useState } from 'react';
import type { CadDocument, CadView, ViewKind } from '@/lib/cad/types';
import { cn } from '@/lib/utils';

const VIEW_ICONS: Record<ViewKind, typeof Box> = {
    plan: LayoutPanelTop,
    ceiling: LayoutPanelTop,
    elevation: Compass,
    section: Scissors,
    threeD: Box,
    schedule: Table2,
    site: Mountain,
};

type ProjectBrowserProps = {
    document: CadDocument;
    groups: { title: string; views: CadView[] }[];
    activeViewId: string;
    onOpenView: (id: string) => void;
};

export function ProjectBrowser({
    document,
    groups,
    activeViewId,
    onOpenView,
}: ProjectBrowserProps) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
        Families: true,
    });
    const [query, setQuery] = useState('');

    const matches = (name: string) =>
        query.trim() === '' ||
        name.toLowerCase().includes(query.trim().toLowerCase());

    // A search opens every branch and hides what does not match.
    const searching = query.trim() !== '';
    const visibleGroups = groups
        .map((group) => ({
            ...group,
            views: group.views.filter((view) => matches(view.name)),
        }))
        .filter((group) => !searching || group.views.length > 0);

    const toggle = (key: string) =>
        setCollapsed((previous) => ({ ...previous, [key]: !previous[key] }));

    return (
        <div className="flex h-full flex-col overflow-hidden bg-chrome text-chrome-fg">
            <PanelHeading>Project Browser</PanelHeading>

            <label className="flex h-8 shrink-0 items-center gap-1.5 border-b border-chrome-border px-3">
                <Search className="size-3.5 shrink-0 text-chrome-muted" />
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search…"
                    className="w-full bg-transparent text-[0.75rem] text-chrome-fg outline-none placeholder:text-chrome-muted"
                />
                {query !== '' && (
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="text-[0.68rem] text-chrome-muted hover:text-chrome-fg"
                    >
                        Clear
                    </button>
                )}
            </label>

            <div className="flex-1 scrollbar-chrome overflow-y-auto px-1 pb-3 text-[0.78rem]">
                <TreeNode
                    label="Views (all)"
                    open
                    onToggle={() => undefined}
                    depth={0}
                />

                {visibleGroups.map((group) => (
                    <div key={group.title}>
                        <TreeNode
                            label={group.title}
                            open={searching || !collapsed[group.title]}
                            onToggle={() => toggle(group.title)}
                            depth={1}
                            badge={String(group.views.length)}
                        />

                        {(searching || !collapsed[group.title]) &&
                            group.views.map((view) => {
                                const Icon = VIEW_ICONS[view.kind];

                                return (
                                    <button
                                        key={view.id}
                                        type="button"
                                        onDoubleClick={() =>
                                            onOpenView(view.id)
                                        }
                                        onClick={() => onOpenView(view.id)}
                                        className={cn(
                                            'flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left transition-colors',
                                            view.id === activeViewId
                                                ? 'bg-sand/20 text-sand'
                                                : 'hover:bg-chrome-raised',
                                        )}
                                        style={{
                                            paddingLeft: `${2 * 0.75 + 0.85}rem`,
                                        }}
                                    >
                                        <Icon className="size-3.5 shrink-0 opacity-70" />
                                        <span className="truncate">
                                            {view.name}
                                        </span>
                                    </button>
                                );
                            })}
                    </div>
                ))}

                <div className="mt-2">
                    <TreeNode
                        label="Families"
                        open={!collapsed.Families}
                        onToggle={() => toggle('Families')}
                        depth={0}
                    />

                    {!collapsed.Families && (
                        <>
                            <FamilyGroup
                                icon={BrickWall}
                                title="Walls"
                                items={document.wallTypes.map(
                                    (type) => type.name,
                                )}
                            />
                            <FamilyGroup
                                icon={DoorOpen}
                                title="Doors"
                                items={document.doorTypes.map(
                                    (type) => type.name,
                                )}
                            />
                            <FamilyGroup
                                icon={AppWindow}
                                title="Windows"
                                items={document.windowTypes.map(
                                    (type) => type.name,
                                )}
                            />
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export function PanelHeading({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-8 shrink-0 items-center border-b border-chrome-border px-3">
            <span className="ax-eyebrow text-[0.6rem] text-sand">
                {children}
            </span>
        </div>
    );
}

type TreeNodeProps = {
    label: string;
    open: boolean;
    onToggle: () => void;
    depth: number;
    badge?: string;
};

function TreeNode({ label, open, onToggle, depth, badge }: TreeNodeProps) {
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center gap-1 rounded-sm py-1 pr-2 text-left transition-colors hover:bg-chrome-raised"
            style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
        >
            <Chevron className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate font-medium">{label}</span>
            {badge && (
                <span className="ml-auto text-[0.68rem] text-chrome-muted">
                    {badge}
                </span>
            )}
        </button>
    );
}

type FamilyGroupProps = {
    icon: typeof Box;
    title: string;
    items: string[];
};

function FamilyGroup({ icon: Icon, title, items }: FamilyGroupProps) {
    const [open, setOpen] = useState(false);
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <div>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-1 rounded-sm py-1 pr-2 pl-3 text-left transition-colors hover:bg-chrome-raised"
            >
                <Chevron className="size-3.5 shrink-0 opacity-60" />
                <Icon className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate">{title}</span>
                <span className="ml-auto text-[0.68rem] text-chrome-muted">
                    {items.length}
                </span>
            </button>

            {open &&
                items.map((item) => (
                    <div
                        key={item}
                        className="truncate py-0.5 pr-2 pl-9 text-[0.74rem] text-chrome-muted"
                    >
                        {item}
                    </div>
                ))}
        </div>
    );
}
