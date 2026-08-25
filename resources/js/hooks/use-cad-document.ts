import { useCallback, useMemo, useReducer } from 'react';
import type { CadDocument } from '@/lib/cad/types';

const HISTORY_LIMIT = 80;

type State = {
    document: CadDocument;
    past: CadDocument[];
    future: CadDocument[];
    /** Label of the most recent committed change, shown on the undo button. */
    lastAction: string | null;
    /** Revision counter; compared against the last saved revision. */
    revision: number;
    savedRevision: number;
};

type Action =
    | { type: 'commit'; label: string; document: CadDocument }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'saved'; revision: number };

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'commit': {
            if (action.document === state.document) {
                return state;
            }

            return {
                ...state,
                document: action.document,
                past: [...state.past, state.document].slice(-HISTORY_LIMIT),
                future: [],
                lastAction: action.label,
                revision: state.revision + 1,
            };
        }
        case 'undo': {
            const previous = state.past.at(-1);

            if (!previous) {
                return state;
            }

            return {
                ...state,
                document: previous,
                past: state.past.slice(0, -1),
                future: [state.document, ...state.future].slice(
                    0,
                    HISTORY_LIMIT,
                ),
                revision: state.revision + 1,
            };
        }
        case 'redo': {
            const next = state.future[0];

            if (!next) {
                return state;
            }

            return {
                ...state,
                document: next,
                past: [...state.past, state.document].slice(-HISTORY_LIMIT),
                future: state.future.slice(1),
                revision: state.revision + 1,
            };
        }
        case 'saved':
            return { ...state, savedRevision: action.revision };
    }
}

/**
 * Fill in anything an older document is missing so the editor can assume a
 * complete shape.
 */
export function normalizeDocument(document: CadDocument): CadDocument {
    return {
        ...document,
        levels: document.levels ?? [],
        wallTypes: document.wallTypes ?? [],
        doorTypes: document.doorTypes ?? [],
        windowTypes: document.windowTypes ?? [],
        elements: document.elements ?? [],
        viewSettings: document.viewSettings ?? {},
    };
}

export type CadDocumentStore = {
    document: CadDocument;
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    isDirty: boolean;
    lastAction: string | null;
    commit: (
        label: string,
        updater: (document: CadDocument) => CadDocument,
    ) => void;
    undo: () => void;
    redo: () => void;
    markSaved: (revision: number) => void;
};

/**
 * Undoable model document. Each commit snapshots the whole document, which is
 * cheap at the scale a single project reaches and keeps every edit reversible
 * without bespoke inverse operations.
 */
export function useCadDocument(initial: CadDocument): CadDocumentStore {
    const [state, dispatch] = useReducer(reducer, undefined, () => ({
        document: normalizeDocument(initial),
        past: [],
        future: [],
        lastAction: null,
        revision: 0,
        savedRevision: 0,
    }));

    const commit = useCallback(
        (label: string, updater: (document: CadDocument) => CadDocument) => {
            dispatch({
                type: 'commit',
                label,
                document: updater(state.document),
            });
        },
        [state.document],
    );

    const undo = useCallback(() => dispatch({ type: 'undo' }), []);
    const redo = useCallback(() => dispatch({ type: 'redo' }), []);
    const markSaved = useCallback(
        (revision: number) => dispatch({ type: 'saved', revision }),
        [],
    );

    return useMemo(
        () => ({
            document: state.document,
            revision: state.revision,
            canUndo: state.past.length > 0,
            canRedo: state.future.length > 0,
            isDirty: state.revision !== state.savedRevision,
            lastAction: state.lastAction,
            commit,
            undo,
            redo,
            markSaved,
        }),
        [state, commit, undo, redo, markSaved],
    );
}
