/**
 * Format an accumulated working duration for display.
 *
 * Under a minute reads as "under a minute" rather than counting seconds —
 * this is studio time, not a stopwatch.
 */
export function formatDuration(seconds: number): string {
    if (seconds <= 0) {
        return 'No time yet';
    }

    if (seconds < 60) {
        return 'Under a minute';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours === 0) {
        return `${minutes} min`;
    }

    if (hours < 100) {
        return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
    }

    return `${hours.toLocaleString('en-CA')} h`;
}

/** Relative day used across the listing pages. */
export function formatRelativeDay(iso: string | null): string {
    if (!iso) {
        return 'Never';
    }

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
