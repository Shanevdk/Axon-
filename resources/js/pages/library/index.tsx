import { Form, Head, Link, router } from '@inertiajs/react';
import {
    Armchair,
    FileUp,
    Pencil,
    PencilRuler,
    Plus,
    Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
import { MeshImportError, parseMesh } from '@/lib/cad/exchange/mesh-import';
import type { ImportedMesh } from '@/lib/cad/exchange/mesh-import';
import { itemSnapshot, payloadFromMesh } from '@/lib/cad/library';
import type { ShelfItem } from '@/lib/cad/library';
import { formatRelativeDay } from '@/lib/duration';
import { designer, destroy, index, rename, store } from '@/routes/library';

type LibraryPageProps = {
    items: ShelfItem[];
};

/** A file parsed and pictured, waiting for its name. */
type Arrival = {
    mesh: ImportedMesh;
    thumbnail: string;
    filename: string;
};

export default function LibraryIndex({ items }: LibraryPageProps) {
    const [arrival, setArrival] = useState<Arrival | null>(null);
    const [renaming, setRenaming] = useState<ShelfItem | null>(null);
    const [trouble, setTrouble] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const categories = useMemo(() => {
        const grouped = new Map<string, ShelfItem[]>();

        for (const item of items) {
            grouped.set(item.category, [
                ...(grouped.get(item.category) ?? []),
                item,
            ]);
        }

        return [...grouped.entries()];
    }, [items]);

    /** Parse the chosen file in the browser and photograph it. */
    async function accept(file: File) {
        setTrouble(null);

        try {
            const mesh = parseMesh(file.name, await file.arrayBuffer());

            setArrival({
                mesh,
                thumbnail: itemSnapshot(mesh.vertices),
                filename: file.name,
            });
        } catch (failure) {
            setTrouble(
                failure instanceof MeshImportError
                    ? failure.message
                    : 'That file could not be read. OBJ and STL files work here.',
            );
        }
    }

    return (
        <>
            <Head title="Library" />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="ax-eyebrow text-muted-foreground">Axon</p>
                        <h1 className="mt-2 text-2xl font-light tracking-tight">
                            Library
                        </h1>
                        <div className="ax-rule mt-3" />
                        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                            The studio's shelf of reusable items. Import a model
                            file or design one part by part, and it is there for
                            everyone to place in any drawing — straight from the
                            editor.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".obj,.stl"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];

                                if (file) {
                                    void accept(file);
                                }

                                event.target.value = '';
                            }}
                        />
                        <Button
                            variant="outline"
                            onClick={() => fileInput.current?.click()}
                        >
                            <FileUp className="size-4" />
                            Import a file
                        </Button>
                        <Button asChild>
                            <Link href={designer()}>
                                <PencilRuler className="size-4" />
                                Design an item
                            </Link>
                        </Button>
                    </div>
                </header>

                {trouble && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                        {trouble}
                    </p>
                )}

                {items.length === 0 ? (
                    <EmptyShelf onImport={() => fileInput.current?.click()} />
                ) : (
                    <div className="space-y-8">
                        {categories.map(([category, shelved]) => (
                            <section key={category}>
                                <h2 className="ax-eyebrow text-muted-foreground">
                                    {category} · {shelved.length}
                                </h2>
                                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {shelved.map((item) => (
                                        <ItemCard
                                            key={item.id}
                                            item={item}
                                            onRename={() => setRenaming(item)}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            <NameArrivalDialog
                arrival={arrival}
                onOpenChange={(open) => {
                    if (!open) {
                        setArrival(null);
                    }
                }}
            />

            <RenameDialog
                item={renaming}
                onOpenChange={(open) => {
                    if (!open) {
                        setRenaming(null);
                    }
                }}
            />
        </>
    );
}

/* ------------------------------------------------------------------ cards */

function ItemCard({
    item,
    onRename,
}: {
    item: ShelfItem;
    onRename: () => void;
}) {
    return (
        <article className="group overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-ring/50">
            <div className="flex h-40 items-center justify-center border-b border-border bg-paper-warm p-3">
                <img
                    src={item.thumbnail}
                    alt={item.name}
                    className="max-h-full max-w-full"
                />
            </div>

            <div className="flex items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                        {item.kind === 'designed' ? 'Designed' : 'Imported'} ·{' '}
                        {item.triangles.toLocaleString('en-CA')} triangles
                        {item.author ? ` · ${item.author}` : ''} ·{' '}
                        {formatRelativeDay(item.created_at)}
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {item.editable && (
                        <Link
                            href={designer({ query: { item: item.id } })}
                            aria-label={`Edit ${item.name} in the designer`}
                            title="Open in the designer"
                            className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                            <PencilRuler className="size-4" />
                        </Link>
                    )}
                    <button
                        type="button"
                        aria-label={`Rename ${item.name}`}
                        title="Rename"
                        onClick={onRename}
                        className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                        <Pencil className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label={`Remove ${item.name}`}
                        title="Remove from the library"
                        onClick={() => {
                            if (
                                window.confirm(
                                    `Remove “${item.name}” from the library? Copies already placed in drawings keep their geometry.`,
                                )
                            ) {
                                router.delete(destroy(item.id), {
                                    preserveScroll: true,
                                });
                            }
                        }}
                        className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                        <Trash2 className="size-4" />
                    </button>
                </div>
            </div>
        </article>
    );
}

/* ---------------------------------------------------------------- dialogs */

/**
 * A file has been read and photographed; all it needs is a name.
 */
function NameArrivalDialog({
    arrival,
    onOpenChange,
}: {
    arrival: Arrival | null;
    onOpenChange: (open: boolean) => void;
}) {
    const suggested = arrival
        ? arrival.filename.replace(/\.(obj|stl)$/i, '').replace(/[-_]+/g, ' ')
        : '';

    return (
        <Dialog open={arrival !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Name it for the shelf</DialogTitle>
                    <DialogDescription>
                        {arrival &&
                            `${arrival.mesh.triangleCount.toLocaleString('en-CA')} triangles, ` +
                                `${Math.round(arrival.mesh.size.x)} × ${Math.round(arrival.mesh.size.y)} × ${Math.round(arrival.mesh.size.z)} mm.`}
                    </DialogDescription>
                </DialogHeader>

                {arrival && (
                    <>
                        <div className="flex h-44 items-center justify-center rounded-lg border border-border bg-paper-warm p-3">
                            <img
                                src={arrival.thumbnail}
                                alt="Preview"
                                className="max-h-full max-w-full"
                            />
                        </div>

                        <Form
                            action={store()}
                            method="post"
                            transform={(data) => ({
                                ...data,
                                kind: 'imported',
                                thumbnail: arrival.thumbnail,
                                payload: payloadFromMesh(arrival.mesh),
                            })}
                            onSuccess={() => onOpenChange(false)}
                            className="space-y-4"
                        >
                            {({ errors, processing }) => (
                                <>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <Field label="Name" error={errors.name}>
                                            <Input
                                                name="name"
                                                defaultValue={suggested}
                                                autoFocus
                                                required
                                            />
                                        </Field>
                                        <Field
                                            label="Category"
                                            error={errors.category}
                                        >
                                            <Input
                                                name="category"
                                                defaultValue="Furniture"
                                                required
                                            />
                                        </Field>
                                    </div>

                                    <DialogFooter>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() => onOpenChange(false)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="submit"
                                            disabled={processing}
                                        >
                                            {processing
                                                ? 'Saving…'
                                                : 'Put it on the shelf'}
                                        </Button>
                                    </DialogFooter>
                                </>
                            )}
                        </Form>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

function RenameDialog({
    item,
    onOpenChange,
}: {
    item: ShelfItem | null;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={item !== null} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Rename {item?.name}</DialogTitle>
                    <DialogDescription>
                        The geometry stays exactly as it is.
                    </DialogDescription>
                </DialogHeader>

                {item && (
                    <Form
                        key={item.id}
                        action={rename(item.id)}
                        method="patch"
                        options={{ preserveScroll: true }}
                        onSuccess={() => onOpenChange(false)}
                        className="space-y-4"
                    >
                        {({ errors, processing }) => (
                            <>
                                <Field label="Name" error={errors.name}>
                                    <Input
                                        name="name"
                                        defaultValue={item.name}
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <Field label="Category" error={errors.category}>
                                    <Input
                                        name="category"
                                        defaultValue={item.category}
                                        required
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
                                        {processing ? 'Saving…' : 'Save'}
                                    </Button>
                                </DialogFooter>
                            </>
                        )}
                    </Form>
                )}
            </DialogContent>
        </Dialog>
    );
}

function EmptyShelf({ onImport }: { onImport: () => void }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
            <Armchair className="size-8 text-sand" />
            <h2 className="mt-4 text-lg font-medium">The shelf is empty</h2>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Import an OBJ or STL file, or design a couch, a table, a lamp —
                anything — part by part. Saved items can be placed in any
                drawing from the editor.
            </p>
            <div className="mt-5 flex items-center gap-3">
                <Button variant="outline" onClick={onImport}>
                    <FileUp className="size-4" />
                    Import a file
                </Button>
                <Button asChild>
                    <Link href={designer()}>
                        <Plus className="size-4" />
                        Design an item
                    </Link>
                </Button>
            </div>
        </div>
    );
}

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

LibraryIndex.layout = {
    breadcrumbs: [
        {
            title: 'Library',
            href: index(),
        },
    ],
};
