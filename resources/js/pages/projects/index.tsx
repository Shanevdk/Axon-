import { Head, Link, router } from '@inertiajs/react';
import { Download, HardDrive, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NewProjectDialog } from '@/components/cad/new-project-dialog';
import { buildPlanModel, PlanThumbnail } from '@/components/cad/plan-thumbnail';
import type { PlanModel } from '@/components/cad/plan-thumbnail';
import { Button } from '@/components/ui/button';
import { downloadDrawing, parseDrawing } from '@/lib/cad/transfer';
import type { CadDocument, Units } from '@/lib/cad/types';
import { formatArea } from '@/lib/cad/units';
import { openVault } from '@/lib/cad/vault';
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

    // Every project is listed, but only some are drawn on this machine. Null
    // while the vault is still being read, so nothing flashes the wrong badge.
    const [held, setHeld] = useState<Set<number> | null>(null);
    const [rereads, setRereads] = useState(0);

    useEffect(() => {
        let cancelled = false;

        void openVault()
            .then((vault) => vault.list())
            .then((ids) => {
                if (!cancelled) {
                    setHeld(new Set(ids));
                }
            });

        return () => {
            cancelled = true;
        };
    }, [rereads]);

    // Bumped after an import, to look at the vault again.
    const refreshHeld = useCallback(() => setRereads((n) => n + 1), []);

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
                                here={held?.has(project.id) ?? null}
                                onChanged={refreshHeld}
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
    here,
    onChanged,
}: {
    project: ProjectRow;
    plan: PlanModel | null;
    /** Null while the vault is still being read. */
    here: boolean | null;
    onChanged: () => void;
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

            <Whereabouts project={project} here={here} onChanged={onChanged} />

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

/**
 * Where this drawing actually is, and how to move it.
 *
 * The project row always comes from the server; the model does not. This
 * strip is the difference between the two — it says whether the machine you
 * are sitting at holds the drawing, and gives you the file either way.
 */
function Whereabouts({
    project,
    here,
    onChanged,
}: {
    project: ProjectRow;
    here: boolean | null;
    onChanged: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    async function send() {
        setBusy(true);
        setFailure(null);

        try {
            const vault = await openVault();
            const held = await vault.read(project.id);

            if (!held) {
                setFailure('That drawing is no longer on this computer.');

                return;
            }

            downloadDrawing(held.document, project.name);
        } finally {
            setBusy(false);
        }
    }

    async function take(file: File) {
        setBusy(true);
        setFailure(null);

        try {
            const drawing = parseDrawing(await file.text());
            const vault = await openVault();

            await vault.write(project.id, drawing, 0);
            onChanged();
        } catch (problem) {
            setFailure(
                problem instanceof Error
                    ? problem.message
                    : 'That file could not be read.',
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="border-t border-border px-5 py-2.5">
            <div className="flex items-center justify-between gap-2">
                <span
                    className={cn(
                        'flex items-center gap-1.5 text-[0.65rem]',
                        here === null && 'text-muted-foreground/60',
                        here === true && 'text-muted-foreground',
                        here === false && 'text-sand',
                    )}
                >
                    <HardDrive className="size-3" />
                    {here === null
                        ? 'Checking…'
                        : here
                          ? 'On this computer'
                          : 'Not on this computer'}
                </span>

                {here === true ? (
                    <button
                        type="button"
                        onClick={send}
                        disabled={busy}
                        className="flex items-center gap-1 text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                        <Download className="size-3" />
                        Download drawing
                    </button>
                ) : (
                    here === false && (
                        <label className="flex cursor-pointer items-center gap-1 text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground">
                            <input
                                type="file"
                                accept=".json,application/json"
                                className="hidden"
                                disabled={busy}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];

                                    if (file) {
                                        void take(file);
                                    }

                                    // Let the same file be chosen twice.
                                    event.target.value = '';
                                }}
                            />
                            <Upload className="size-3" />
                            Open a drawing file
                        </label>
                    )
                )}
            </div>

            {failure && (
                <p className="mt-1.5 text-[0.65rem] text-destructive">
                    {failure}
                </p>
            )}
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
