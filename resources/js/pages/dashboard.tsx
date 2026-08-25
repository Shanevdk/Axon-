import { Head, Link } from '@inertiajs/react';
import { ArrowRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NewProjectDialog } from '@/components/cad/new-project-dialog';
import { buildPlanModel, PlanThumbnail } from '@/components/cad/plan-thumbnail';
import type { PlanModel } from '@/components/cad/plan-thumbnail';
import { Button } from '@/components/ui/button';
import type { CadDocument, Units } from '@/lib/cad/types';
import { formatArea, formatLength } from '@/lib/cad/units';
import { dashboard } from '@/routes';
import { index as projectsIndex, show } from '@/routes/projects';

type ProjectRow = {
    id: number;
    name: string;
    number: string | null;
    client: string | null;
    address: string | null;
    units: Units;
    opened_at: string | null;
    updated_at: string | null;
    summary: {
        levels: number;
        walls: number;
        rooms: number;
        openings: number;
        wallLength: number;
        slabArea: number;
    };
    preview: CadDocument | null;
};

type Totals = {
    projects: number;
    levels: number;
    walls: number;
    rooms: number;
    openings: number;
    wallLength: number;
    slabArea: number;
};

type DashboardProps = {
    projects: ProjectRow[];
    totals: Totals;
    wallTypes: { name: string; length: number }[];
};

const REGISTER_LIMIT = 6;

export default function Dashboard({
    projects,
    totals,
    wallTypes,
}: DashboardProps) {
    const [creating, setCreating] = useState(false);

    // Plans are resolved once here and shared by the hero card and the register.
    const plans = useMemo(
        () =>
            new Map<number, PlanModel | null>(
                projects.map((project) => [
                    project.id,
                    buildPlanModel(project.preview),
                ]),
            ),
        [projects],
    );

    const current = projects[0];
    const units = current?.units ?? 'metric';

    const largestRooms = useMemo(() => {
        const rooms = projects.flatMap((project) =>
            (plans.get(project.id)?.rooms ?? []).map((room) => ({
                key: `${project.id}-${room.element.id}`,
                name: room.element.name,
                number: room.element.number,
                project: project.name,
                area: room.boundary.area,
            })),
        );

        return rooms.sort((a, b) => b.area - a.area).slice(0, 6);
    }, [plans, projects]);

    if (projects.length === 0) {
        return (
            <>
                <Head title="Studio" />
                <div className="flex h-full flex-1 flex-col p-6">
                    <StudioHeader onCreate={() => setCreating(true)} />
                    <div className="flex flex-1 flex-col items-center justify-center border border-dashed border-border text-center">
                        <div className="h-20 w-28">
                            <PlanThumbnail model={null} />
                        </div>
                        <h2 className="mt-5 text-lg font-medium">
                            Nothing on the boards yet
                        </h2>
                        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                            Start a model and this page fills with plans, areas
                            and quantities read straight from it.
                        </p>
                        <Button
                            className="mt-5"
                            onClick={() => setCreating(true)}
                        >
                            <Plus className="size-4" />
                            New project
                        </Button>
                    </div>
                </div>
                <NewProjectDialog open={creating} onOpenChange={setCreating} />
            </>
        );
    }

    return (
        <>
            <Head title="Studio" />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <StudioHeader onCreate={() => setCreating(true)} />

                <section className="grid gap-5 lg:grid-cols-3">
                    <CurrentProject
                        project={current}
                        plan={plans.get(current.id) ?? null}
                    />
                    <PracticeSchedule totals={totals} units={units} />
                </section>

                <ProjectRegister projects={projects} plans={plans} />

                <section className="grid gap-8 lg:grid-cols-2">
                    <BarPanel
                        title="Largest spaces"
                        caption="Areas resolved from the enclosing walls"
                        empty="Place room tags in an enclosed space to schedule areas."
                        rows={largestRooms.map((room) => ({
                            key: room.key,
                            label: `${room.name} ${room.number}`,
                            meta: room.project,
                            value: room.area,
                            display: formatArea(room.area, units),
                        }))}
                    />

                    <BarPanel
                        title="Wall types by length"
                        caption="Centre line length across every project"
                        empty="Draw some walls to see the breakdown."
                        rows={wallTypes.slice(0, 6).map((type) => ({
                            key: type.name,
                            label: type.name,
                            value: type.length,
                            display: formatLength(type.length, units),
                        }))}
                    />
                </section>
            </div>

            <NewProjectDialog open={creating} onOpenChange={setCreating} />
        </>
    );
}

function StudioHeader({ onCreate }: { onCreate: () => void }) {
    const today = new Date().toLocaleDateString('en-CA', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

    return (
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
            <div>
                <p className="ax-eyebrow text-muted-foreground">Axon</p>
                <h1 className="mt-2 text-2xl font-light tracking-tight">
                    Studio
                </h1>
                <div className="ax-rule mt-3" />
            </div>

            <div className="flex items-center gap-4">
                <p className="hidden text-xs text-muted-foreground sm:block">
                    {today}
                </p>
                <Button onClick={onCreate}>
                    <Plus className="size-4" />
                    New project
                </Button>
            </div>
        </header>
    );
}

function CurrentProject({
    project,
    plan,
}: {
    project: ProjectRow;
    plan: PlanModel | null;
}) {
    const facts = [
        { label: 'Levels', value: String(project.summary.levels) },
        { label: 'Walls', value: String(project.summary.walls) },
        { label: 'Openings', value: String(project.summary.openings) },
        {
            label: 'Enclosed area',
            value: plan ? formatArea(plan.roomArea, project.units) : '—',
        },
    ];

    return (
        <article className="overflow-hidden rounded-lg border border-border bg-card lg:col-span-2">
            <div className="grid sm:grid-cols-[minmax(0,1fr)_1.15fr]">
                <div className="aspect-[4/3] border-b border-border bg-paper-warm p-3 sm:aspect-auto sm:border-r sm:border-b-0">
                    <PlanThumbnail model={plan} />
                </div>

                <div className="flex flex-col p-5">
                    <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                        {project.opened_at ? 'Continue' : 'Ready to start'}
                    </p>

                    <h2 className="mt-2 text-xl font-medium tracking-tight">
                        {project.number && (
                            <span className="mr-2 font-mono text-sm text-sand">
                                {project.number}
                            </span>
                        )}
                        {project.name}
                    </h2>

                    <p className="mt-1 text-sm text-muted-foreground">
                        {project.client ?? 'No client recorded'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                        {project.address ?? 'No site address'}
                    </p>

                    <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border pt-4">
                        {facts.map((fact) => (
                            <div key={fact.label}>
                                <dt className="text-[0.62rem] tracking-wider text-muted-foreground uppercase">
                                    {fact.label}
                                </dt>
                                <dd className="mt-0.5 text-base font-light tabular-nums">
                                    {fact.value}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    <div className="mt-auto flex items-center gap-3 pt-5">
                        <Link
                            href={show(project.id)}
                            prefetch
                            className="inline-flex items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm text-paper transition-colors hover:bg-ink-soft dark:bg-sand dark:text-ink dark:hover:opacity-90"
                        >
                            Open model
                            <ArrowRight className="size-4" />
                        </Link>
                        <span className="text-xs text-muted-foreground">
                            {project.opened_at
                                ? `Last opened ${relativeDay(project.opened_at)}`
                                : 'Never opened'}
                        </span>
                    </div>
                </div>
            </div>
        </article>
    );
}

function PracticeSchedule({ totals, units }: { totals: Totals; units: Units }) {
    const rows = [
        { label: 'Projects', value: String(totals.projects) },
        { label: 'Levels', value: String(totals.levels) },
        { label: 'Walls', value: String(totals.walls) },
        { label: 'Openings', value: String(totals.openings) },
        { label: 'Rooms tagged', value: String(totals.rooms) },
        { label: 'Wall length', value: formatLength(totals.wallLength, units) },
        { label: 'Slab area', value: formatArea(totals.slabArea, units) },
    ];

    return (
        <aside className="rounded-lg border border-border bg-card p-5">
            <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                Practice
            </p>
            <div className="ax-rule mt-3" />

            <dl className="mt-4 divide-y divide-border">
                {rows.map((row) => (
                    <div
                        key={row.label}
                        className="flex items-baseline justify-between py-2.5"
                    >
                        <dt className="text-sm text-muted-foreground">
                            {row.label}
                        </dt>
                        <dd className="text-sm font-medium tabular-nums">
                            {row.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </aside>
    );
}

function ProjectRegister({
    projects,
    plans,
}: {
    projects: ProjectRow[];
    plans: Map<number, PlanModel | null>;
}) {
    return (
        <section>
            <div className="flex items-end justify-between border-b border-border pb-2">
                <p className="ax-eyebrow text-muted-foreground">
                    Project register
                </p>
                <Link
                    href={projectsIndex()}
                    prefetch
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                    All projects
                    <ArrowRight className="size-3" />
                </Link>
            </div>

            <ul className="divide-y divide-border">
                {projects.slice(0, REGISTER_LIMIT).map((project) => (
                    <li key={project.id}>
                        <Link
                            href={show(project.id)}
                            prefetch
                            className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-4 py-3 transition-colors hover:bg-accent/50 sm:grid-cols-[3.5rem_minmax(0,1.3fr)_minmax(0,1fr)_auto]"
                        >
                            <div className="h-11 overflow-hidden rounded-sm border border-border bg-paper-warm p-1">
                                <PlanThumbnail
                                    model={plans.get(project.id) ?? null}
                                    showRooms={false}
                                />
                            </div>

                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                    {project.number && (
                                        <span className="mr-2 font-mono text-xs text-sand">
                                            {project.number}
                                        </span>
                                    )}
                                    {project.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {project.address ??
                                        project.client ??
                                        'No site address'}
                                </p>
                            </div>

                            <p className="hidden truncate text-xs text-muted-foreground tabular-nums sm:block">
                                {project.summary.levels} levels ·{' '}
                                {project.summary.walls} walls ·{' '}
                                {project.summary.rooms} rooms
                            </p>

                            <p className="text-right text-xs text-muted-foreground">
                                {project.opened_at
                                    ? relativeDay(project.opened_at)
                                    : 'New'}
                            </p>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

type BarRow = {
    key: string;
    label: string;
    meta?: string;
    value: number;
    display: string;
};

function BarPanel({
    title,
    caption,
    empty,
    rows,
}: {
    title: string;
    caption: string;
    empty: string;
    rows: BarRow[];
}) {
    const peak = Math.max(...rows.map((row) => row.value), 1);

    return (
        <div>
            <div className="border-b border-border pb-2">
                <p className="ax-eyebrow text-muted-foreground">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
            </div>

            {rows.length === 0 ? (
                <p className="py-8 text-sm text-muted-foreground">{empty}</p>
            ) : (
                <ul className="mt-4 space-y-3.5">
                    {rows.map((row) => (
                        <li key={row.key}>
                            <div className="flex items-baseline justify-between gap-4">
                                <span className="truncate text-sm">
                                    {row.label}
                                </span>
                                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                                    {row.display}
                                </span>
                            </div>
                            <div className="mt-1.5 h-1 w-full bg-secondary">
                                <div
                                    className="h-1 bg-sand"
                                    style={{
                                        width: `${(row.value / peak) * 100}%`,
                                    }}
                                />
                            </div>
                            {row.meta && (
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                    {row.meta}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function relativeDay(iso: string): string {
    const date = new Date(iso);
    const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);

    if (days <= 0) {
        return 'today';
    }

    if (days === 1) {
        return 'yesterday';
    }

    if (days < 30) {
        return `${days} days ago`;
    }

    return date.toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

Dashboard.layout = {
    breadcrumbs: [
        {
            title: 'Studio',
            href: dashboard(),
        },
    ],
};
