import { Head, Link, router } from '@inertiajs/react';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NewProjectDialog } from '@/components/cad/new-project-dialog';
import { buildPlanModel, PlanThumbnail } from '@/components/cad/plan-thumbnail';
import type { PlanModel } from '@/components/cad/plan-thumbnail';
import { Button } from '@/components/ui/button';
import type { CadDocument, Units } from '@/lib/cad/types';
import { formatArea } from '@/lib/cad/units';
import { cn } from '@/lib/utils';
import { destroy, index, show } from '@/routes/projects';

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

export default function ProjectsIndex({
    projects,
}: {
    projects: ProjectRow[];
}) {
    const [creating, setCreating] = useState(false);

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

    return (
        <>
            <Head title="Projects" />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="ax-eyebrow text-muted-foreground">Axon</p>
                        <h1 className="mt-2 text-2xl font-light tracking-tight">
                            Projects
                        </h1>
                        <div className="ax-rule mt-3" />
                        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                            Every model is one live document — walls, openings,
                            rooms and levels — and opens straight into the
                            modelling environment.
                        </p>
                    </div>

                    <Button onClick={() => setCreating(true)}>
                        <Plus className="size-4" />
                        New project
                    </Button>
                </header>

                {projects.length === 0 ? (
                    <EmptyState onCreate={() => setCreating(true)} />
                ) : (
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {projects.map((project) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                plan={plans.get(project.id) ?? null}
                            />
                        ))}
                    </div>
                )}
            </div>

            <NewProjectDialog open={creating} onOpenChange={setCreating} />
        </>
    );
}

function ProjectCard({
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
            label: 'Enclosed',
            value: plan ? formatArea(plan.roomArea, project.units) : '—',
        },
    ];

    return (
        <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-sand">
            <Link
                href={show(project.id)}
                prefetch
                className="flex flex-1 flex-col"
            >
                <div className="aspect-[16/10] border-b border-border bg-paper-warm p-3">
                    <PlanThumbnail model={plan} />
                </div>

                <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="font-mono text-xs text-sand">
                                {project.number ?? '—'}
                            </p>
                            <h2 className="mt-1 truncate text-base font-medium">
                                {project.name}
                            </h2>
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">
                                {project.client ?? 'No client recorded'}
                            </p>
                        </div>
                        <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-[0.6rem] tracking-wide text-muted-foreground uppercase">
                            {project.units === 'imperial' ? 'ft-in' : 'mm'}
                        </span>
                    </div>

                    <dl className="mt-auto grid grid-cols-4 gap-2 border-t border-border pt-3">
                        {facts.map((fact) => (
                            <div key={fact.label}>
                                <dt className="text-[0.58rem] tracking-wider text-muted-foreground uppercase">
                                    {fact.label}
                                </dt>
                                <dd className="mt-0.5 truncate text-sm font-light tabular-nums">
                                    {fact.value}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    <p className="text-[0.7rem] text-muted-foreground">
                        {project.opened_at
                            ? `Last opened ${formatWhen(project.opened_at)}`
                            : 'Never opened'}
                    </p>
                </div>
            </Link>

            <button
                type="button"
                aria-label={`Delete ${project.name}`}
                onClick={() => {
                    if (
                        window.confirm(
                            `Delete "${project.name}"? This cannot be undone.`,
                        )
                    ) {
                        router.delete(destroy(project.id));
                    }
                }}
                className={cn(
                    'absolute top-3 right-3 rounded-sm bg-paper/80 p-1.5 text-muted-foreground opacity-0 backdrop-blur transition',
                    'group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100',
                )}
            >
                <Trash2 className="size-4" />
            </button>
        </div>
    );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
            <div className="h-20 w-28">
                <PlanThumbnail model={null} />
            </div>
            <h2 className="mt-5 text-lg font-medium">No projects yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Start from a blank model, or open the worked example residence
                to see walls, rooms and schedules already in place.
            </p>
            <Button className="mt-5" onClick={onCreate}>
                <Plus className="size-4" />
                New project
            </Button>
        </div>
    );
}

function formatWhen(iso: string): string {
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
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

ProjectsIndex.layout = {
    breadcrumbs: [
        {
            title: 'Projects',
            href: index(),
        },
    ],
};
