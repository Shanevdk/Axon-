import { Head, Link, usePage } from '@inertiajs/react';
import {
    ArrowRight,
    Box,
    Camera,
    HardDrive,
    Layers,
    Ruler,
    Sparkles,
    Table2,
} from 'lucide-react';
import AppLogoIcon from '@/components/app-logo-icon';
import { PaletteStrip } from '@/components/palette-picker';
import { dashboard, login } from '@/routes';
import { index as projects } from '@/routes/projects';

/**
 * The front page.
 *
 * It has two jobs. To a visitor it is the only place Vanhaven explains itself.
 * To someone who has just signed up it is a welcome mat — the sign-in that
 * created their account lands here, and every sign-in afterwards goes
 * straight to the studio, so this page is read once and then skipped.
 */
export default function Welcome() {
    const { auth } = usePage().props;

    return (
        <>
            <Head title="Architectural design software" />

            <div className="min-h-screen bg-paper text-ink">
                <SiteHeader signedIn={Boolean(auth.user)} />

                <main>
                    {auth.user ? (
                        <WelcomeIn name={auth.user.name} />
                    ) : (
                        <Pitch />
                    )}

                    <Capabilities />
                    <Craft />
                </main>

                <SiteFooter />
            </div>
        </>
    );
}

/* ------------------------------------------------------------------ chrome */

function SiteHeader({ signedIn }: { signedIn: boolean }) {
    return (
        <header className="sticky top-0 z-20 border-b border-border/70 bg-paper/85 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                <Link href="/" className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-sm border border-sand text-ink">
                        <AppLogoIcon className="size-5" />
                    </span>
                    <span className="leading-none">
                        <span className="block text-sm font-semibold tracking-[0.2em]">
                            AXON
                        </span>
                        <span className="ax-eyebrow mt-1.5 block text-[0.58rem] text-ink-muted">
                            Design Software
                        </span>
                    </span>
                </Link>

                <div className="flex items-center gap-4">
                    <PaletteStrip className="hidden sm:flex" />

                    <nav className="flex items-center gap-1 text-sm sm:gap-2">
                        {signedIn ? (
                            <>
                                <Link
                                    href={dashboard()}
                                    className="rounded-sm px-3 py-2 text-ink-muted transition-colors hover:text-ink sm:px-4"
                                >
                                    Studio
                                </Link>
                                <Link
                                    href={projects()}
                                    className="rounded-sm bg-ink px-4 py-2 text-paper transition-colors hover:bg-ink-soft"
                                >
                                    Open projects
                                </Link>
                            </>
                        ) : (
                            <>
                                <Link
                                    href={login()}
                                    className="rounded-sm px-3 py-2 text-ink-muted transition-colors hover:text-ink sm:px-4"
                                >
                                    Log in
                                </Link>
                                <Link
                                    href={login()}
                                    className="rounded-sm bg-ink px-4 py-2 text-paper transition-colors hover:bg-ink-soft"
                                >
                                    Enter the studio
                                </Link>
                            </>
                        )}
                    </nav>
                </div>
            </div>
        </header>
    );
}

function SiteFooter() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-ink-muted">
                <p>
                    Vanhaven — Vancouver, British Columbia. Built by{' '}
                    <a
                        href="https://vanhaven.ca"
                        className="underline underline-offset-4 transition-colors hover:text-ink"
                    >
                        Van Haven
                    </a>
                    .
                </p>
                <p>Lengths held in millimetres, shown in your project units.</p>
            </div>
        </footer>
    );
}

/* -------------------------------------------------------------- the pitch */

function Pitch() {
    return (
        <section className="relative overflow-hidden">
            {/* A drafting grid, faint enough to read as paper rather than decoration. */}
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.045]"
                style={{
                    backgroundImage:
                        'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
                    backgroundSize: '48px 48px',
                    maskImage:
                        'radial-gradient(120% 90% at 50% 0%, #000 40%, transparent 100%)',
                }}
            />

            <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
                <div>
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-paper px-3 py-1 text-[0.7rem] text-ink-muted">
                        <span className="size-1.5 rounded-full bg-ember" />
                        Bespoke residential &amp; interior
                    </span>

                    <h1 className="mt-7 text-[2.6rem] leading-[1.05] font-light tracking-[-0.02em] text-balance sm:text-6xl">
                        Draw it once.
                        <span className="block font-semibold">
                            See it every way.
                        </span>
                    </h1>

                    <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-muted">
                        A building information modeller that runs in a browser
                        tab. Levels, compound wall types, hosted openings, rooms
                        that measure themselves and schedules that read straight
                        off the model — one document, every view drawn from it.
                    </p>

                    <div className="mt-9 flex flex-wrap items-center gap-3">
                        <Link
                            href={login()}
                            className="group flex items-center gap-2 rounded-md bg-ember px-6 py-3 text-sm font-medium text-paper shadow-sm transition-all hover:shadow-md hover:brightness-110"
                        >
                            Start modelling
                            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        <Link
                            href={login()}
                            className="rounded-md border border-border px-6 py-3 text-sm transition-colors hover:border-ink"
                        >
                            I have an account
                        </Link>
                    </div>

                    <dl className="mt-12 grid max-w-lg grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
                        {[
                            ['Nothing', 'to install'],
                            ['Millimetres', 'stored, always'],
                            ['On device', 'your drawings stay'],
                        ].map(([figure, caption]) => (
                            <div key={caption} className="bg-paper px-4 py-3">
                                <dt className="text-sm font-medium">
                                    {figure}
                                </dt>
                                <dd className="mt-0.5 text-[0.7rem] text-ink-muted">
                                    {caption}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>

                <PlanSketch />
            </div>
        </section>
    );
}

/* ------------------------------------------------------------ the welcome */

const FIRST_STEPS = [
    {
        step: '01',
        title: 'Start a drawing',
        body: 'Name it, pick metric or imperial, and Vanhaven opens on Level 1 with a wall type ready to go.',
    },
    {
        step: '02',
        title: 'Put up walls',
        body: 'Press WA and draw. Openings host themselves into walls with DR and WN; rooms find their own boundary with RM.',
    },
    {
        step: '03',
        title: 'Look at it',
        body: 'The Project Browser has plans, elevations, sections and a 3D view of the same model. Press RE to photograph it.',
    },
];

function WelcomeIn({ name }: { name: string }) {
    const firstName = name.trim().split(/\s+/)[0];

    return (
        <section className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
            <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
                <div>
                    <p className="ax-eyebrow text-ink-muted">
                        Your account is ready
                    </p>
                    <div className="ax-rule mt-4" />
                    <h1 className="mt-6 text-4xl leading-[1.08] font-light tracking-tight sm:text-5xl">
                        Welcome,
                        <span className="font-semibold"> {firstName}</span>.
                    </h1>
                    <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
                        This page is the introduction, and you only get it once
                        — from your next sign-in Vanhaven opens straight into the
                        studio. Here is the shape of the thing.
                    </p>

                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <Link
                            href={projects()}
                            className="group flex items-center gap-2 rounded-sm bg-ember px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                        >
                            Start your first drawing
                            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        <Link
                            href={dashboard()}
                            className="rounded-sm border border-ink/20 px-6 py-3 text-sm transition-colors hover:border-ink"
                        >
                            Go to the studio
                        </Link>
                    </div>
                </div>

                <PlanSketch />
            </div>

            <ol className="mt-16 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
                {FIRST_STEPS.map((item) => (
                    <li key={item.step} className="bg-paper p-6">
                        <p className="font-mono text-xs text-sand">
                            {item.step}
                        </p>
                        <h2 className="mt-3 text-base font-medium">
                            {item.title}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                            {item.body}
                        </p>
                    </li>
                ))}
            </ol>

            <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
                <HardDrive className="mt-0.5 size-3.5 shrink-0 text-sand" />
                One thing worth knowing: models are kept on the computer that
                drew them, not on our server. To work on a drawing elsewhere,
                download it from the projects page and open the file there.
            </p>
        </section>
    );
}

/* ------------------------------------------------------------ what it does */

const CAPABILITIES = [
    {
        icon: Layers,
        title: 'Draw in plan',
        body: 'Walls mitre into one another, doors and windows cut real openings, and every snap you would expect is there — endpoint, midpoint, intersection, perpendicular.',
    },
    {
        icon: Box,
        title: 'See it in three dimensions',
        body: 'The same model renders as a shaded 3D view, a hidden line elevation or a cut section. Orbit it, pick an element, and the properties palette follows.',
    },
    {
        icon: Ruler,
        title: 'Rooms that measure themselves',
        body: 'Drop a room tag in an enclosed space and it finds its own boundary, area and perimeter. Move a wall and the number moves with it.',
    },
    {
        icon: Table2,
        title: 'Schedules off the model',
        body: 'Room, door, window and wall schedules read straight from the document, so a quantity is never out of step with the drawing.',
    },
    {
        icon: Camera,
        title: 'Photograph the design',
        body: 'A brief measured off your own model — storeys, footprint, glazing, roof pitch — handed to an image generator. Costs nothing to run.',
    },
    {
        icon: Sparkles,
        title: 'An assistant that reads drawings',
        body: 'Ask it anything, about the building or otherwise. Claude can connect directly to the model over MCP and draw into it.',
    },
];

function Capabilities() {
    return (
        <section className="border-t border-border bg-paper-warm">
            <div className="mx-auto max-w-6xl px-6 py-16">
                <p className="ax-eyebrow text-ink-muted">What it does</p>
                <div className="ax-rule mt-4" />

                <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                    {CAPABILITIES.map((item) => (
                        <div key={item.title} className="flex gap-4">
                            <item.icon className="mt-1 size-5 shrink-0 text-sand" />
                            <div>
                                <h2 className="text-base font-medium">
                                    {item.title}
                                </h2>
                                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                                    {item.body}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

/* -------------------------------------------------------- how it is built */

const CONVICTIONS = [
    {
        heading: 'Millimetres, always',
        body: 'Every length in the document is stored in millimetres no matter which units you draw in. Imperial is a way of reading the model, never a way of storing it, so nothing drifts in conversion.',
    },
    {
        heading: 'Your drawings are yours',
        body: 'The model lives in the browser on the machine that drew it and is saved a quarter of a second after every change. The server keeps a thumbnail and a handful of counts — enough to list the job, and nothing more.',
    },
    {
        heading: 'One document, many views',
        body: 'Plans, elevations, sections, schedules and the 3D view are not copies. They are readings of the same document, so a wall moved in plan is a wall moved everywhere.',
    },
];

function Craft() {
    return (
        <section className="border-t border-border">
            <div className="mx-auto max-w-6xl px-6 py-16">
                <p className="ax-eyebrow text-ink-muted">How it is built</p>
                <div className="ax-rule mt-4" />

                <dl className="mt-10 grid gap-10 sm:grid-cols-3">
                    {CONVICTIONS.map((item) => (
                        <div key={item.heading}>
                            <dt className="text-base font-medium">
                                {item.heading}
                            </dt>
                            <dd className="mt-2 text-sm leading-relaxed text-ink-muted">
                                {item.body}
                            </dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    );
}

/* ----------------------------------------------------------------- drawing */

/**
 * A miniature floor plan in the editor's own language — poché walls, a door
 * swing, glazing and a dimension string — drawing itself on arrival.
 *
 * Every colour is a palette variable rather than a literal, so the sketch
 * follows the chosen theme and inverts properly in dark mode.
 */
function PlanSketch() {
    return (
        <div className="rounded-lg border border-border bg-paper-warm p-4 shadow-sm">
            <svg
                viewBox="0 0 420 320"
                className="w-full"
                role="img"
                aria-label="Floor plan drawing itself"
            >
                <defs>
                    <pattern
                        id="ax-grid"
                        width="20"
                        height="20"
                        patternUnits="userSpaceOnUse"
                    >
                        <path
                            d="M20 0H0v20"
                            fill="none"
                            stroke="var(--edge)"
                            strokeWidth="1"
                        />
                    </pattern>
                </defs>

                <rect width="420" height="320" fill="url(#ax-grid)" />

                {/* Exterior shell, poché as the editor draws it at Coarse. */}
                <g
                    className="ax-draw"
                    style={{ '--ax-draw-length': 1200 } as React.CSSProperties}
                >
                    <rect
                        x="60"
                        y="60"
                        width="300"
                        height="200"
                        fill="var(--accent-tone-light)"
                        stroke="var(--ink)"
                        strokeWidth="2"
                    />
                </g>

                <rect
                    x="72"
                    y="72"
                    width="276"
                    height="176"
                    fill="var(--paper)"
                    className="ax-appear"
                    style={{ animationDelay: '0.5s' }}
                />

                {/* Interior partition. */}
                <g
                    className="ax-draw"
                    style={
                        {
                            '--ax-draw-length': 200,
                            animationDelay: '0.6s',
                        } as React.CSSProperties
                    }
                >
                    <rect
                        x="216"
                        y="72"
                        width="10"
                        height="176"
                        fill="var(--accent-tone-pale)"
                        stroke="var(--ink-muted)"
                        strokeWidth="1.4"
                    />
                </g>

                {/* A door, leaf and swing. */}
                <g className="ax-appear" style={{ animationDelay: '1.1s' }}>
                    <rect
                        x="216"
                        y="130"
                        width="10"
                        height="46"
                        fill="var(--paper)"
                    />
                    <path
                        d="M226 130 226 176"
                        stroke="var(--ink-muted)"
                        strokeWidth="1"
                    />
                    <path
                        d="M226 176 L272 176"
                        stroke="var(--ink)"
                        strokeWidth="1.4"
                    />
                    <path
                        d="M272 176 A46 46 0 0 0 226 130"
                        fill="none"
                        stroke="var(--ink-muted)"
                        strokeWidth="0.9"
                        strokeDasharray="3 3"
                    />
                </g>

                {/* Glazing in the south wall. */}
                <g className="ax-appear" style={{ animationDelay: '1.25s' }}>
                    <rect
                        x="110"
                        y="252"
                        width="84"
                        height="16"
                        fill="var(--paper)"
                    />
                    <path
                        d="M110 260 194 260"
                        stroke="var(--cta-tone)"
                        strokeWidth="2.4"
                    />
                    <path
                        d="M110 252 110 268 M194 252 194 268"
                        stroke="var(--ink)"
                        strokeWidth="1.2"
                    />
                </g>

                {/* Room tags, the way the editor sets them. */}
                <g
                    className="ax-appear"
                    style={{ animationDelay: '1.4s' }}
                    textAnchor="middle"
                >
                    <text
                        x="144"
                        y="152"
                        fill="var(--ink-soft)"
                        fontSize="13"
                        fontFamily="Karla, sans-serif"
                    >
                        Living
                    </text>
                    <text
                        x="144"
                        y="168"
                        fill="var(--ink-muted)"
                        fontSize="10"
                        fontFamily="Karla, sans-serif"
                    >
                        32.6 m²
                    </text>
                    <text
                        x="290"
                        y="152"
                        fill="var(--ink-soft)"
                        fontSize="13"
                        fontFamily="Karla, sans-serif"
                    >
                        Studio
                    </text>
                    <text
                        x="290"
                        y="168"
                        fill="var(--ink-muted)"
                        fontSize="10"
                        fontFamily="Karla, sans-serif"
                    >
                        21.1 m²
                    </text>
                </g>

                {/* Dimension string with witness lines and ticks. */}
                <g className="ax-appear" style={{ animationDelay: '1.55s' }}>
                    <path
                        d="M60 292 360 292"
                        stroke="var(--cta-tone)"
                        strokeWidth="0.9"
                    />
                    <path
                        d="M60 282 60 300 M360 282 360 300 M216 282 216 300"
                        stroke="var(--cta-tone)"
                        strokeWidth="0.9"
                    />
                    <rect
                        x="176"
                        y="284"
                        width="68"
                        height="16"
                        fill="var(--paper)"
                    />
                    <text
                        x="210"
                        y="296"
                        fill="var(--cta-tone)"
                        fontSize="10"
                        textAnchor="middle"
                        fontFamily="Karla, sans-serif"
                    >
                        9 000
                    </text>
                </g>
            </svg>
        </div>
    );
}
