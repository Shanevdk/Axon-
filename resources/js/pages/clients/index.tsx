import { Form, Head, Link, router } from '@inertiajs/react';
import {
    Building2,
    ChevronDown,
    Clock,
    Mail,
    Pencil,
    Phone,
    Plus,
    Trash2,
    Unlink,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildPlanModel, PlanThumbnail } from '@/components/cad/plan-thumbnail';
import type { PlanModel } from '@/components/cad/plan-thumbnail';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CadDocument, Units } from '@/lib/cad/types';
import { formatDuration, formatRelativeDay } from '@/lib/duration';
import { cn } from '@/lib/utils';
import { destroy, index, store, update } from '@/routes/clients';
import { assign, unassign } from '@/routes/clients/projects';
import { show as showProject } from '@/routes/projects';

type DrawingRow = {
    id: number;
    name: string;
    number: string | null;
    address: string | null;
    units: Units;
    worked_seconds: number;
    worked_at: string | null;
    opened_at: string | null;
    summary: { levels: number; walls: number; rooms: number };
    preview: CadDocument | null;
};

type ClientRow = {
    id: number;
    name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    total_seconds: number;
    last_worked_at: string | null;
    projects: DrawingRow[];
};

type ClientsPageProps = {
    clients: ClientRow[];
    unassigned: DrawingRow[];
};

export default function ClientsIndex({
    clients,
    unassigned,
}: ClientsPageProps) {
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<ClientRow | null>(null);

    const plans = useMemo(() => {
        const all = [
            ...clients.flatMap((client) => client.projects),
            ...unassigned,
        ];

        return new Map<number, PlanModel | null>(
            all.map((drawing) => [drawing.id, buildPlanModel(drawing.preview)]),
        );
    }, [clients, unassigned]);

    const totalSeconds = clients.reduce(
        (total, client) => total + client.total_seconds,
        0,
    );

    return (
        <>
            <Head title="Clients" />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="ax-eyebrow text-muted-foreground">Axon</p>
                        <h1 className="mt-2 text-2xl font-light tracking-tight">
                            Clients
                        </h1>
                        <div className="ax-rule mt-3" />
                        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                            Assign drawings to the people they are for. Time is
                            measured from the drawing board itself — every save
                            while you model counts toward the hours, and a break
                            longer than ten minutes ends the session.
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        {clients.length > 0 && (
                            <p className="hidden text-xs text-muted-foreground sm:block">
                                {clients.length}{' '}
                                {clients.length === 1 ? 'client' : 'clients'} ·{' '}
                                {formatDuration(totalSeconds)} on the boards
                            </p>
                        )}
                        <Button onClick={() => setAdding(true)}>
                            <Plus className="size-4" />
                            Add client
                        </Button>
                    </div>
                </header>

                {clients.length === 0 ? (
                    <EmptyState onAdd={() => setAdding(true)} />
                ) : (
                    <div className="space-y-6">
                        {clients.map((client) => (
                            <ClientCard
                                key={client.id}
                                client={client}
                                unassigned={unassigned}
                                plans={plans}
                                onEdit={() => setEditing(client)}
                            />
                        ))}
                    </div>
                )}

                {unassigned.length > 0 && clients.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                        {unassigned.length}{' '}
                        {unassigned.length === 1
                            ? 'drawing is'
                            : 'drawings are'}{' '}
                        not assigned to any client yet — use “Assign drawing” on
                        a client above.
                    </p>
                )}
            </div>

            <ClientDialog
                open={adding}
                onOpenChange={setAdding}
                client={null}
            />
            <ClientDialog
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditing(null);
                    }
                }}
                client={editing}
            />
        </>
    );
}

/* ------------------------------------------------------------ client card */

function ClientCard({
    client,
    unassigned,
    plans,
    onEdit,
}: {
    client: ClientRow;
    unassigned: DrawingRow[];
    plans: Map<number, PlanModel | null>;
    onEdit: () => void;
}) {
    return (
        <article className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-muted/30 px-5 py-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <h2 className="truncate text-lg font-medium">
                            {client.name}
                        </h2>
                        {client.company && (
                            <span className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                                <Building2 className="size-3.5 shrink-0" />
                                {client.company}
                            </span>
                        )}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                        {client.email && (
                            <a
                                href={`mailto:${client.email}`}
                                className="flex items-center gap-1 transition-colors hover:text-foreground"
                            >
                                <Mail className="size-3" />
                                {client.email}
                            </a>
                        )}
                        {client.phone && (
                            <span className="flex items-center gap-1">
                                <Phone className="size-3" />
                                {client.phone}
                            </span>
                        )}
                    </div>

                    {client.notes && (
                        <p className="mt-2 max-w-xl text-xs text-muted-foreground">
                            {client.notes}
                        </p>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-right">
                        <p className="flex items-center justify-end gap-1.5 text-sm font-medium tabular-nums">
                            <Clock className="size-3.5 text-sand" />
                            {formatDuration(client.total_seconds)}
                        </p>
                        <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                            {client.projects.length}{' '}
                            {client.projects.length === 1
                                ? 'drawing'
                                : 'drawings'}{' '}
                            · last worked{' '}
                            {formatRelativeDay(
                                client.last_worked_at,
                            ).toLowerCase()}
                        </p>
                    </div>

                    <div className="flex items-center gap-1">
                        <AssignMenu client={client} unassigned={unassigned} />
                        <IconButton
                            label={`Edit ${client.name}`}
                            onClick={onEdit}
                        >
                            <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                            label={`Remove ${client.name}`}
                            destructive
                            onClick={() => {
                                if (
                                    window.confirm(
                                        `Remove "${client.name}"? Their drawings stay in the studio, unassigned.`,
                                    )
                                ) {
                                    router.delete(destroy(client.id), {
                                        preserveScroll: true,
                                    });
                                }
                            }}
                        >
                            <Trash2 className="size-4" />
                        </IconButton>
                    </div>
                </div>
            </div>

            {client.projects.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">
                    No drawings assigned yet.
                </p>
            ) : (
                <ul className="divide-y divide-border">
                    {client.projects.map((drawing) => (
                        <li key={drawing.id}>
                            <div className="group grid grid-cols-[3.5rem_minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-accent/50">
                                <Link href={showProject(drawing.id)} prefetch>
                                    <div className="h-11 overflow-hidden rounded-sm border border-border bg-paper-warm p-1">
                                        <PlanThumbnail
                                            model={
                                                plans.get(drawing.id) ?? null
                                            }
                                            showRooms={false}
                                        />
                                    </div>
                                </Link>

                                <Link
                                    href={showProject(drawing.id)}
                                    prefetch
                                    className="min-w-0"
                                >
                                    <p className="truncate text-sm font-medium">
                                        {drawing.number && (
                                            <span className="mr-2 font-mono text-xs text-sand">
                                                {drawing.number}
                                            </span>
                                        )}
                                        {drawing.name}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {drawing.address ?? 'No site address'} ·{' '}
                                        {drawing.summary.walls} walls ·{' '}
                                        {drawing.summary.rooms} rooms
                                    </p>
                                </Link>

                                <div className="text-right">
                                    <p className="text-sm tabular-nums">
                                        {formatDuration(drawing.worked_seconds)}
                                    </p>
                                    <p className="text-[0.7rem] text-muted-foreground">
                                        {drawing.worked_at
                                            ? `worked ${formatRelativeDay(drawing.worked_at).toLowerCase()}`
                                            : 'not started'}
                                    </p>
                                </div>

                                <IconButton
                                    label={`Unassign ${drawing.name}`}
                                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                    onClick={() =>
                                        router.delete(
                                            unassign([client.id, drawing.id]),
                                            {
                                                preserveScroll: true,
                                            },
                                        )
                                    }
                                >
                                    <Unlink className="size-4" />
                                </IconButton>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </article>
    );
}

/* ----------------------------------------------------------- assign menu */

function AssignMenu({
    client,
    unassigned,
}: {
    client: ClientRow;
    unassigned: DrawingRow[];
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <Button
                variant="outline"
                size="sm"
                disabled={unassigned.length === 0}
                onClick={() => setOpen((previous) => !previous)}
                title={
                    unassigned.length === 0
                        ? 'Every drawing is already assigned'
                        : 'Assign a drawing to this client'
                }
            >
                Assign drawing
                <ChevronDown className="size-3.5" />
            </Button>

            {open && (
                <>
                    <button
                        type="button"
                        aria-label="Close"
                        className="fixed inset-0 z-10 cursor-default"
                        onClick={() => setOpen(false)}
                    />
                    <div className="absolute right-0 z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
                        {unassigned.map((drawing) => (
                            <button
                                key={drawing.id}
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    router.post(
                                        assign(client.id),
                                        { project_id: drawing.id },
                                        { preserveScroll: true },
                                    );
                                }}
                                className="w-full rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent"
                            >
                                <p className="truncate text-sm">
                                    {drawing.number && (
                                        <span className="mr-2 font-mono text-xs text-sand">
                                            {drawing.number}
                                        </span>
                                    )}
                                    {drawing.name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {formatDuration(drawing.worked_seconds)} on
                                    the boards
                                </p>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/* -------------------------------------------------------------- dialogs */

function ClientDialog({
    open,
    onOpenChange,
    client,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    client: ClientRow | null;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {client ? `Edit ${client.name}` : 'Add client'}
                    </DialogTitle>
                    <DialogDescription>
                        {client
                            ? 'Renaming a client updates the title block on their drawings.'
                            : 'A client can then have drawings assigned to them.'}
                    </DialogDescription>
                </DialogHeader>

                <Form
                    key={client?.id ?? 'new'}
                    action={client ? update(client.id) : store()}
                    method={client ? 'put' : 'post'}
                    options={{ preserveScroll: true }}
                    onSuccess={() => onOpenChange(false)}
                    resetOnSuccess
                    className="space-y-4"
                >
                    {({ errors, processing }) => (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Name" error={errors.name}>
                                    <Input
                                        name="name"
                                        defaultValue={client?.name ?? ''}
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <Field label="Company" error={errors.company}>
                                    <Input
                                        name="company"
                                        defaultValue={client?.company ?? ''}
                                    />
                                </Field>
                                <Field label="Email" error={errors.email}>
                                    <Input
                                        name="email"
                                        type="email"
                                        defaultValue={client?.email ?? ''}
                                    />
                                </Field>
                                <Field label="Phone" error={errors.phone}>
                                    <Input
                                        name="phone"
                                        defaultValue={client?.phone ?? ''}
                                    />
                                </Field>
                            </div>

                            <Field label="Notes" error={errors.notes}>
                                <textarea
                                    name="notes"
                                    defaultValue={client?.notes ?? ''}
                                    rows={3}
                                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring"
                                />
                            </Field>

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={processing}>
                                    {processing
                                        ? 'Saving…'
                                        : client
                                          ? 'Save changes'
                                          : 'Add client'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
            <Building2 className="size-8 text-sand" />
            <h2 className="mt-4 text-lg font-medium">No clients yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Add the people you draw for, assign their drawings, and the
                hours on each project collect themselves as you model.
            </p>
            <Button className="mt-5" onClick={onAdd}>
                <Plus className="size-4" />
                Add client
            </Button>
        </div>
    );
}

/* --------------------------------------------------------------- shared */

function Field({
    label,
    error,
    children,
}: {
    label: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid gap-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {label}
            </Label>
            {children}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

function IconButton({
    label,
    destructive = false,
    className,
    onClick,
    children,
}: {
    label: string;
    destructive?: boolean;
    className?: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            onClick={onClick}
            className={cn(
                'rounded-sm p-1.5 text-muted-foreground transition-colors',
                destructive
                    ? 'hover:bg-destructive/10 hover:text-destructive'
                    : 'hover:bg-accent hover:text-foreground',
                className,
            )}
        >
            {children}
        </button>
    );
}

ClientsIndex.layout = {
    breadcrumbs: [
        {
            title: 'Clients',
            href: index(),
        },
    ],
};
