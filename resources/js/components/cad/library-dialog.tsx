import { Link } from '@inertiajs/react';
import { Armchair, PencilRuler, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { insertMesh } from '@/lib/cad/exchange/insert';
import { meshFromPayload } from '@/lib/cad/library';
import type { LibraryPayload, ShelfItem } from '@/lib/cad/library';
import {
    feed,
    index as libraryIndex,
    payload as payloadRoute,
} from '@/routes/library';

type LibraryDialogProps = {
    editor: CadEditor;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

type Shelf =
    | { state: 'loading' }
    | { state: 'failed' }
    | { state: 'ready'; items: ShelfItem[] };

/**
 * The library, from inside the editor: browse the shelf, click an item, and
 * it lands in the middle of the view ready to drag into place.
 */
export function LibraryDialog({
    editor,
    open,
    onOpenChange,
}: LibraryDialogProps) {
    const [shelf, setShelf] = useState<Shelf>({ state: 'loading' });
    const [search, setSearch] = useState('');
    const [placingId, setPlacingId] = useState<number | null>(null);

    // Fetched fresh on every open — a colleague may have shelved something
    // since the last look. The previous shelf stays on screen while the new
    // one arrives, which also keeps state changes out of the effect body.
    useEffect(() => {
        if (!open) {
            return;
        }

        let cancelled = false;

        fetch(feed.url(), { headers: { Accept: 'application/json' } })
            .then((response) => (response.ok ? response.json() : null))
            .then((body: { items: ShelfItem[] } | null) => {
                if (!cancelled) {
                    setShelf(
                        body
                            ? { state: 'ready', items: body.items }
                            : { state: 'failed' },
                    );
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setShelf({ state: 'failed' });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open]);

    const items =
        shelf.state === 'ready'
            ? shelf.items.filter((item) =>
                  `${item.name} ${item.category}`
                      .toLowerCase()
                      .includes(search.trim().toLowerCase()),
              )
            : [];

    /** Fetch the geometry and set it down in the middle of the view. */
    function place(item: ShelfItem) {
        if (placingId !== null) {
            return;
        }

        setPlacingId(item.id);

        fetch(payloadRoute.url({ libraryItem: item.id }), {
            headers: { Accept: 'application/json' },
        })
            .then((response) => (response.ok ? response.json() : null))
            .then((body: { name: string; payload: LibraryPayload } | null) => {
                if (!body) {
                    setPlacingId(null);

                    return;
                }

                const mesh = meshFromPayload(body.name, body.payload);
                const levelId = editor.level.id;
                const at = editor.camera.center;

                editor.store.commit(
                    'Place library item',
                    (current) =>
                        insertMesh(current, mesh, { levelId, at, scale: 1 })
                            .document,
                );
                editor.setStatus(`${item.name} placed — drag it into position`);
                setPlacingId(null);
                onOpenChange(false);
            })
            .catch(() => setPlacingId(null));
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Armchair className="size-4 text-sand" />
                        Library
                    </DialogTitle>
                    <DialogDescription>
                        Click an item and it lands in the middle of the view.
                    </DialogDescription>
                </DialogHeader>

                <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search the shelf"
                        aria-label="Search the library"
                        className="pl-8"
                    />
                </div>

                <div className="min-h-48 flex-1 overflow-y-auto">
                    {shelf.state === 'loading' && (
                        <p className="animate-pulse py-12 text-center text-sm text-muted-foreground">
                            Fetching the shelf…
                        </p>
                    )}

                    {shelf.state === 'failed' && (
                        <p className="py-12 text-center text-sm text-destructive">
                            The library could not be reached. Try again in a
                            moment.
                        </p>
                    )}

                    {shelf.state === 'ready' && shelf.items.length === 0 && (
                        <div className="flex flex-col items-center gap-3 py-12 text-center">
                            <p className="max-w-sm text-sm text-muted-foreground">
                                Nothing on the shelf yet. Import a file or
                                design an item and it will appear here.
                            </p>
                            <Link
                                href={libraryIndex()}
                                className="flex items-center gap-1.5 text-sm underline underline-offset-4"
                            >
                                <PencilRuler className="size-3.5" />
                                Open the library
                            </Link>
                        </div>
                    )}

                    {shelf.state === 'ready' && items.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                            {items.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    disabled={placingId !== null}
                                    onClick={() => place(item)}
                                    className="group overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-ring disabled:opacity-60"
                                >
                                    <span className="flex h-28 items-center justify-center border-b border-border bg-paper-warm p-2">
                                        <img
                                            src={item.thumbnail}
                                            alt=""
                                            className="max-h-full max-w-full transition-transform group-hover:scale-105"
                                        />
                                    </span>
                                    <span className="block px-2.5 py-2">
                                        <span className="block truncate text-xs font-medium">
                                            {placingId === item.id
                                                ? 'Placing…'
                                                : item.name}
                                        </span>
                                        <span className="block truncate text-[0.65rem] text-muted-foreground">
                                            {item.category}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {shelf.state === 'ready' &&
                        shelf.items.length > 0 &&
                        items.length === 0 && (
                            <p className="py-12 text-center text-sm text-muted-foreground">
                                Nothing on the shelf matches “{search.trim()}”.
                            </p>
                        )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
