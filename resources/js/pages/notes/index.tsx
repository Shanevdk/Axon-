import { Form, Head, router } from '@inertiajs/react';
import {
    Box,
    NotebookPen,
    Pencil,
    Pin,
    PinOff,
    Plus,
    Search,
    Trash2,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatRelativeDay } from '@/lib/duration';
import { cn } from '@/lib/utils';
import { destroy, index, pin, store, update } from '@/routes/notes';

type DrawingOption = {
    id: number;
    name: string;
    number: string | null;
};

type NoteRow = {
    id: number;
    title: string;
    body: string | null;
    excerpt: string;
    pinned: boolean;
    author: string | null;
    project_id: number | null;
    project_name: string | null;
    updated_at: string | null;
};

type NotesPageProps = {
    notes: NoteRow[];
    projects: DrawingOption[];
};

export default function NotesIndex({ notes, projects }: NotesPageProps) {
    const [writing, setWriting] = useState(false);
    const [editing, setEditing] = useState<NoteRow | null>(null);
    const [search, setSearch] = useState('');

    const found = useMemo(() => {
        const needle = search.trim().toLowerCase();

        if (needle === '') {
            return notes;
        }

        return notes.filter((note) =>
            [note.title, note.body ?? '', note.project_name ?? '']
                .join(' ')
                .toLowerCase()
                .includes(needle),
        );
    }, [notes, search]);

    const pinned = found.filter((note) => note.pinned);
    const rest = found.filter((note) => !note.pinned);

    return (
        <>
            <Head title="Notebook" />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="ax-eyebrow text-muted-foreground">Vanhaven</p>
                        <h1 className="mt-2 text-2xl font-light tracking-tight">
                            Notebook
                        </h1>
                        <div className="ax-rule mt-3" />
                        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                            Site observations, decisions taken on a call, the
                            dimension somebody read out over the phone. File a
                            note against a drawing and it stays with the work.
                            Everyone in the studio reads the same notebook.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        {notes.length > 0 && (
                            <div className="relative hidden sm:block">
                                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.target.value)
                                    }
                                    placeholder="Search notes"
                                    aria-label="Search notes"
                                    className="w-56 pl-8"
                                />
                            </div>
                        )}
                        <Button onClick={() => setWriting(true)}>
                            <Plus className="size-4" />
                            New note
                        </Button>
                    </div>
                </header>

                {notes.length === 0 ? (
                    <EmptyState onWrite={() => setWriting(true)} />
                ) : found.length === 0 ? (
                    <p className="py-16 text-center text-sm text-muted-foreground">
                        Nothing in the notebook matches “{search.trim()}”.
                    </p>
                ) : (
                    <div className="space-y-8">
                        {pinned.length > 0 && (
                            <Section
                                title="Pinned"
                                count={pinned.length}
                                notes={pinned}
                                onEdit={setEditing}
                            />
                        )}

                        {rest.length > 0 && (
                            <Section
                                title={
                                    pinned.length > 0
                                        ? 'Everything else'
                                        : 'Notes'
                                }
                                count={rest.length}
                                notes={rest}
                                onEdit={setEditing}
                            />
                        )}
                    </div>
                )}
            </div>

            <NoteDialog
                open={writing}
                onOpenChange={setWriting}
                note={null}
                projects={projects}
            />
            <NoteDialog
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditing(null);
                    }
                }}
                note={editing}
                projects={projects}
            />
        </>
    );
}

/* ------------------------------------------------------------- sections */

function Section({
    title,
    count,
    notes,
    onEdit,
}: {
    title: string;
    count: number;
    notes: NoteRow[];
    onEdit: (note: NoteRow) => void;
}) {
    return (
        <section>
            <h2 className="ax-eyebrow text-muted-foreground">
                {title} · {count}
            </h2>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {notes.map((note) => (
                    <NoteCard
                        key={note.id}
                        note={note}
                        onEdit={() => onEdit(note)}
                    />
                ))}
            </div>
        </section>
    );
}

function NoteCard({ note, onEdit }: { note: NoteRow; onEdit: () => void }) {
    return (
        <article
            className={cn(
                'group flex flex-col rounded-lg border bg-card p-4 transition-colors',
                note.pinned
                    ? 'border-sand/60 bg-paper-warm'
                    : 'border-border hover:border-ring/50',
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 flex-1 text-sm font-medium break-words">
                    {note.title}
                </h3>

                <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                        label={note.pinned ? 'Unpin note' : 'Pin note'}
                        className={cn(
                            note.pinned
                                ? 'text-sand'
                                : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        )}
                        onClick={() =>
                            router.patch(
                                pin(note.id),
                                {},
                                { preserveScroll: true },
                            )
                        }
                    >
                        {note.pinned ? (
                            <PinOff className="size-4" />
                        ) : (
                            <Pin className="size-4" />
                        )}
                    </IconButton>

                    <IconButton
                        label={`Edit ${note.title}`}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={onEdit}
                    >
                        <Pencil className="size-4" />
                    </IconButton>

                    <IconButton
                        label={`Remove ${note.title}`}
                        destructive
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => {
                            if (
                                window.confirm(
                                    `Remove the note “${note.title}”? This cannot be undone.`,
                                )
                            ) {
                                router.delete(destroy(note.id), {
                                    preserveScroll: true,
                                });
                            }
                        }}
                    >
                        <Trash2 className="size-4" />
                    </IconButton>
                </div>
            </div>

            {note.excerpt && (
                <p className="mt-2 flex-1 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                    {note.excerpt}
                </p>
            )}

            <footer className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[0.7rem] text-muted-foreground">
                {note.project_name && (
                    <span className="flex items-center gap-1 truncate">
                        <Box className="size-3 shrink-0 text-sand" />
                        {note.project_name}
                    </span>
                )}
                {note.author && <span className="truncate">{note.author}</span>}
                <span className="ml-auto shrink-0">
                    {formatRelativeDay(note.updated_at)}
                </span>
            </footer>
        </article>
    );
}

/* --------------------------------------------------------------- dialog */

function NoteDialog({
    open,
    onOpenChange,
    note,
    projects,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    note: NoteRow | null;
    projects: DrawingOption[];
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{note ? 'Edit note' : 'New note'}</DialogTitle>
                    <DialogDescription>
                        {note
                            ? 'Revisions replace the note; there is no history kept.'
                            : 'Give it a heading you would recognise in a list, then write freely.'}
                    </DialogDescription>
                </DialogHeader>

                <Form
                    key={note?.id ?? 'new'}
                    action={note ? update(note.id) : store()}
                    method={note ? 'put' : 'post'}
                    options={{ preserveScroll: true }}
                    onSuccess={() => onOpenChange(false)}
                    resetOnSuccess
                    className="space-y-4"
                >
                    {({ errors, processing }) => (
                        <>
                            <Field label="Heading" error={errors.title}>
                                <Input
                                    name="title"
                                    defaultValue={note?.title ?? ''}
                                    placeholder="Site visit — north elevation"
                                    autoFocus
                                    required
                                />
                            </Field>

                            <Field label="Note" error={errors.body}>
                                <textarea
                                    name="body"
                                    defaultValue={note?.body ?? ''}
                                    rows={10}
                                    placeholder="What happened, what was decided, what to check next."
                                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:border-ring"
                                />
                            </Field>

                            <Field
                                label="About which drawing"
                                error={errors.project_id}
                            >
                                <select
                                    name="project_id"
                                    defaultValue={
                                        note?.project_id
                                            ? String(note.project_id)
                                            : ''
                                    }
                                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring"
                                >
                                    <option value="">
                                        Not about a drawing
                                    </option>
                                    {projects.map((project) => (
                                        <option
                                            key={project.id}
                                            value={project.id}
                                        >
                                            {project.number
                                                ? `${project.number} — ${project.name}`
                                                : project.name}
                                        </option>
                                    ))}
                                </select>
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
                                        : note
                                          ? 'Save note'
                                          : 'Write note'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

function EmptyState({ onWrite }: { onWrite: () => void }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
            <NotebookPen className="size-8 text-sand" />
            <h2 className="mt-4 text-lg font-medium">The notebook is blank</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Keep what you would otherwise write on the back of a print —
                site notes, a client's change of mind, the reason a wall moved.
            </p>
            <Button className="mt-5" onClick={onWrite}>
                <Plus className="size-4" />
                New note
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

NotesIndex.layout = {
    breadcrumbs: [
        {
            title: 'Notebook',
            href: index(),
        },
    ],
};
