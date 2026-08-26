/**
 * Where drawings actually live.
 *
 * The server keeps only a thumbnail-sized preview of each project, so the
 * full model — every level, every element, every imported mesh — is held on
 * the machine that drew it, in IndexedDB. That keeps the database small and
 * makes a drawing something you carry rather than something you stream.
 *
 * IndexedDB is used rather than localStorage because a model with an imported
 * mesh runs to megabytes, well past localStorage's quota, and because writing
 * it must not block the drawing loop.
 */

import type { CadDocument } from '@/lib/cad/types';

const DATABASE = 'axon';
const STORE = 'drawings';
const VERSION = 1;

/** One drawing as it sits on this computer. */
export type VaultRecord = {
    projectId: number;
    document: CadDocument;
    /** When it was last written here, ISO 8601. */
    savedAt: string;
    /** The editor revision this copy came from. */
    revision: number;
};

export interface DrawingVault {
    read(projectId: number): Promise<VaultRecord | null>;
    write(
        projectId: number,
        document: CadDocument,
        revision: number,
    ): Promise<VaultRecord>;
    forget(projectId: number): Promise<void>;
    /** The ids of every drawing held on this computer. */
    list(): Promise<number[]>;
}

/**
 * Wrap a document up for storage.
 */
export function toRecord(
    projectId: number,
    document: CadDocument,
    revision: number,
    at: Date = new Date(),
): VaultRecord {
    return {
        projectId,
        document,
        revision,
        savedAt: at.toISOString(),
    };
}

/**
 * Decide which of two copies of a drawing is the one to keep.
 *
 * Revision wins because it counts edits; the timestamp only breaks ties, and
 * a missing copy always loses. This is what stops a stale import from
 * overwriting newer work already on the machine.
 */
export function newerRecord(
    a: VaultRecord | null,
    b: VaultRecord | null,
): VaultRecord | null {
    if (!a) {
        return b;
    }

    if (!b) {
        return a;
    }

    if (a.revision !== b.revision) {
        return a.revision > b.revision ? a : b;
    }

    return a.savedAt >= b.savedAt ? a : b;
}

/**
 * True when this browser can hold drawings properly.
 */
export function vaultIsPersistent(): boolean {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
        // Safari throws rather than returning undefined in private browsing.
        return false;
    }
}

/**
 * Open the vault, falling back to memory when IndexedDB is unavailable.
 *
 * The fallback is deliberate rather than a failure: private browsing blocks
 * IndexedDB entirely, and losing the drawing on refresh beats refusing to let
 * anyone draw at all. The editor warns when it lands here.
 */
export async function openVault(): Promise<DrawingVault> {
    if (!vaultIsPersistent()) {
        return memoryVault();
    }

    try {
        const database = await openDatabase();

        return indexedVault(database);
    } catch {
        return memoryVault();
    }
}

/**
 * A vault that forgets everything when the tab closes.
 */
export function memoryVault(): DrawingVault {
    const held = new Map<number, VaultRecord>();

    return {
        async read(projectId) {
            return held.get(projectId) ?? null;
        },
        async write(projectId, document, revision) {
            const record = toRecord(projectId, document, revision);

            held.set(projectId, record);

            return record;
        },
        async forget(projectId) {
            held.delete(projectId);
        },
        async list() {
            return [...held.keys()].sort((a, b) => a - b);
        },
    };
}

/* ------------------------------------------------------------- indexed db */

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, VERSION);

        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) {
                request.result.createObjectStore(STORE, {
                    keyPath: 'projectId',
                });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
            reject(new Error('The drawing store is open in another tab.'));
    });
}

function indexedVault(database: IDBDatabase): DrawingVault {
    const run = <T>(
        mode: IDBTransactionMode,
        act: (store: IDBObjectStore) => IDBRequest,
    ): Promise<T> =>
        new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE, mode);
            const request = act(transaction.objectStore(STORE));

            request.onsuccess = () => resolve(request.result as T);
            request.onerror = () => reject(request.error);
            transaction.onabort = () => reject(transaction.error);
        });

    return {
        read: (projectId) =>
            run<VaultRecord | undefined>('readonly', (store) =>
                store.get(projectId),
            ).then((record) => record ?? null),

        write: async (projectId, document, revision) => {
            const record = toRecord(projectId, document, revision);

            await run('readwrite', (store) => store.put(record));

            return record;
        },

        forget: (projectId) =>
            run('readwrite', (store) => store.delete(projectId)).then(
                () => undefined,
            ),

        list: () =>
            run<IDBValidKey[]>('readonly', (store) => store.getAllKeys()).then(
                (keys) =>
                    keys
                        .map((key) => Number(key))
                        .filter((key) => Number.isFinite(key))
                        .sort((a, b) => a - b),
            ),
    };
}
