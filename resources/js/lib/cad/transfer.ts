/**
 * Moving a drawing between computers.
 *
 * Because the model lives on the machine that drew it, getting it onto a
 * second machine means carrying a file: download it there, open it here. The
 * file is the plain Axon model document, the same thing the export dialog
 * writes, so a backup and a transfer are the same artefact.
 */

import type { CadDocument } from '@/lib/cad/types';

export const DRAWING_EXTENSION = '.axon.json';

/**
 * A filename that says what it is and which project it came from.
 */
export function drawingFilename(projectName: string): string {
    const stem =
        projectName
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase() || 'drawing';

    return `${stem}${DRAWING_EXTENSION}`;
}

/**
 * Is this parsed JSON actually a model?
 *
 * Deliberately strict about the fields the editor reads on mount, because a
 * document missing its type catalogues is what used to leave the canvas black.
 */
export function isCadDocument(value: unknown): value is CadDocument {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Partial<CadDocument>;

    return (
        typeof candidate.version === 'number' &&
        (candidate.units === 'metric' || candidate.units === 'imperial') &&
        Array.isArray(candidate.levels) &&
        candidate.levels.length > 0 &&
        Array.isArray(candidate.wallTypes) &&
        Array.isArray(candidate.doorTypes) &&
        Array.isArray(candidate.windowTypes) &&
        Array.isArray(candidate.elements)
    );
}

/**
 * Read a carried file back into a model.
 *
 * @throws Error with a sentence worth showing when the file is not a drawing
 */
export function parseDrawing(contents: string): CadDocument {
    let parsed: unknown;

    try {
        parsed = JSON.parse(contents);
    } catch {
        throw new Error('That file is not an Axon drawing — it is not even JSON.');
    }

    if (!isCadDocument(parsed)) {
        throw new Error(
            'That JSON is not an Axon drawing. Export one with File → Export → Axon model.',
        );
    }

    return parsed;
}

/**
 * Write the model out as a file to carry.
 */
export function downloadDrawing(
    document: CadDocument,
    projectName: string,
): void {
    const blob = new Blob([JSON.stringify(document, null, 2)], {
        type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');

    link.href = url;
    link.download = drawingFilename(projectName);
    link.click();

    // Revoking immediately can beat the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
