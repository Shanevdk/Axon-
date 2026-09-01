import { useSyncExternalStore } from 'react';

import { writeCookie } from '@/lib/cookies';

export type ResolvedAppearance = 'light' | 'dark';
export type Appearance = ResolvedAppearance | 'system';

/**
 * Which colour scheme the interface wears.
 *
 * Light and dark decide how bright it is; the palette decides what colour it
 * is. They are stored separately because people want both — a dark blueprint
 * is a perfectly reasonable thing to ask for.
 */
export type Palette = 'graphite' | 'blueprint' | 'sand' | 'mono';

export const PALETTES: {
    value: Palette;
    label: string;
    description: string;
    /** Swatch colours: paper, accent, call to action. */
    swatch: [string, string, string];
}[] = [
    {
        value: 'graphite',
        label: 'Graphite',
        description: 'Cool neutrals and one confident blue.',
        swatch: ['#f6f7f9', '#7e8894', '#1f6feb'],
    },
    {
        value: 'blueprint',
        label: 'Blueprint',
        description: 'The drafting tradition, in ink and paper blue.',
        swatch: ['#f3f6fa', '#6c8cab', '#0b5cad'],
    },
    {
        value: 'sand',
        label: 'Sand',
        description: "Van Haven's warm house palette.",
        swatch: ['#f7f5f2', '#c2ab92', '#f68b21'],
    },
    {
        value: 'mono',
        label: 'Mono',
        description: 'Black and white, nothing else.',
        swatch: ['#f5f5f5', '#8a8a8a', '#000000'],
    },
];

export const DEFAULT_PALETTE: Palette = 'graphite';

const isPalette = (value: unknown): value is Palette =>
    PALETTES.some((item) => item.value === value);

export type UseAppearanceReturn = {
    readonly appearance: Appearance;
    readonly resolvedAppearance: ResolvedAppearance;
    readonly updateAppearance: (mode: Appearance) => void;
};

const listeners = new Set<() => void>();
let currentAppearance: Appearance = 'system';
let currentPalette: Palette = DEFAULT_PALETTE;

const prefersDark = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

const setCookie = (name: string, value: string, days = 365): void => {
    writeCookie(name, value, days * 24 * 60 * 60);
};

const getStoredAppearance = (): Appearance => {
    if (typeof window === 'undefined') {
        return 'system';
    }

    return (localStorage.getItem('appearance') as Appearance) || 'system';
};

const getStoredPalette = (): Palette => {
    if (typeof window === 'undefined') {
        return DEFAULT_PALETTE;
    }

    const stored = localStorage.getItem('palette');

    return isPalette(stored) ? stored : DEFAULT_PALETTE;
};

const applyPalette = (palette: Palette): void => {
    if (typeof document === 'undefined') {
        return;
    }

    document.documentElement.dataset.palette = palette;
};

const isDarkMode = (appearance: Appearance): boolean => {
    return appearance === 'dark' || (appearance === 'system' && prefersDark());
};

const applyTheme = (appearance: Appearance): void => {
    if (typeof document === 'undefined') {
        return;
    }

    const isDark = isDarkMode(appearance);

    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
};

const subscribe = (callback: () => void) => {
    listeners.add(callback);

    return () => listeners.delete(callback);
};

const notify = (): void => listeners.forEach((listener) => listener());

const mediaQuery = (): MediaQueryList | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.matchMedia('(prefers-color-scheme: dark)');
};

const handleSystemThemeChange = (): void => applyTheme(currentAppearance);

export function initializeTheme(): void {
    if (typeof window === 'undefined') {
        return;
    }

    if (!localStorage.getItem('appearance')) {
        localStorage.setItem('appearance', 'system');
        setCookie('appearance', 'system');
    }

    if (!isPalette(localStorage.getItem('palette'))) {
        localStorage.setItem('palette', DEFAULT_PALETTE);
        setCookie('palette', DEFAULT_PALETTE);
    }

    currentAppearance = getStoredAppearance();
    currentPalette = getStoredPalette();

    applyTheme(currentAppearance);
    applyPalette(currentPalette);

    // Set up system theme change listener
    mediaQuery()?.addEventListener('change', handleSystemThemeChange);
}

export function useAppearance(): UseAppearanceReturn {
    const appearance: Appearance = useSyncExternalStore(
        subscribe,
        () => currentAppearance,
        () => 'system',
    );

    const resolvedAppearance: ResolvedAppearance = isDarkMode(appearance)
        ? 'dark'
        : 'light';

    const updateAppearance = (mode: Appearance): void => {
        currentAppearance = mode;

        // Store in localStorage for client-side persistence...
        localStorage.setItem('appearance', mode);

        // Store in cookie for SSR...
        setCookie('appearance', mode);

        applyTheme(mode);
        notify();
    };

    return { appearance, resolvedAppearance, updateAppearance } as const;
}

export type UsePaletteReturn = {
    readonly palette: Palette;
    readonly updatePalette: (palette: Palette) => void;
};

export function usePalette(): UsePaletteReturn {
    const palette: Palette = useSyncExternalStore(
        subscribe,
        () => currentPalette,
        () => DEFAULT_PALETTE,
    );

    const updatePalette = (next: Palette): void => {
        currentPalette = next;

        localStorage.setItem('palette', next);
        // The cookie is what stops the blade shell flashing the wrong theme.
        setCookie('palette', next);

        applyPalette(next);
        notify();
    };

    return { palette, updatePalette } as const;
}
