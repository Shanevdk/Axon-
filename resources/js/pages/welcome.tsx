import { Head, Link, usePage } from '@inertiajs/react';
import { Box, Layers, Ruler, Table2 } from 'lucide-react';
import AppLogoIcon from '@/components/app-logo-icon';
import { dashboard, login, register } from '@/routes';
import { index as projects } from '@/routes/projects';

const CAPABILITIES = [
    {
        icon: Layers,
        title: 'Draw in plan',
        body: 'Walls mitre into one another, doors and windows cut real openings, and every snap you would expect is there — endpoint, midpoint, intersection, perpendicular.',
    },
    {
        icon: Box,
        title: 'See it in three dimensions',
        body: 'The same model renders as a shaded 3D view or a hidden line elevation. Orbit it, pick an element, and the properties palette follows.',
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
];

export default function Welcome() {
    const { auth } = usePage().props;

    return (
        <>
            <Head title="Architectural design software" />

            <div className="min-h-screen bg-paper text-ink">
                <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
                    <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-sm border border-sand text-ink">
                            <AppLogoIcon className="size-5" />
                        </span>
                        <div className="leading-none">
                            <p className="text-sm font-semibold tracking-[0.2em]">
                                AXON
                            </p>
                            <p className="ax-eyebrow mt-1.5 text-[0.58rem] text-ink-muted">
                                Design Software
                            </p>
                        </div>
                    </div>

                    <nav className="flex items-center gap-2 text-sm">
                        {auth.user ? (
                            <>
                                <Link
                                    href={dashboard()}
                                    className="rounded-sm px-4 py-2 text-ink-muted transition-colors hover:text-ink"
                                >
                                    Dashboard
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
                                    className="rounded-sm px-4 py-2 text-ink-muted transition-colors hover:text-ink"
                                >
                                    Log in
                                </Link>
                                <Link
                                    href={register()}
                                    className="rounded-sm bg-ink px-4 py-2 text-paper transition-colors hover:bg-ink-soft"
                                >
                                    Create an account
                                </Link>
                            </>
                        )}
                    </nav>
                </header>

                <main>
                    <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:py-24">
                        <div>
                            <p className="ax-eyebrow text-ink-muted">
                                Bespoke residential &amp; interior
                            </p>
                            <div className="ax-rule mt-4" />
                            <h1 className="mt-6 text-4xl leading-[1.1] font-light tracking-tight sm:text-5xl">
                                Draw it once.
                                <span className="font-semibold">
                                    {' '}
                                    See it every way
                                </span>
                                .
                            </h1>
                            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted">
                                A building information modeller in the browser.
                                Levels, wall types, hosted openings, room
                                boundaries and live schedules — one document,
                                every view reading from it.
                            </p>

                            <div className="mt-8 flex flex-wrap items-center gap-3">
                                <Link
                                    href={auth.user ? projects() : register()}
                                    className="rounded-sm bg-ember px-6 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                                >
                                    {auth.user
                                        ? 'Open a project'
                                        : 'Start modelling'}
                                </Link>
                                <a
                                    href="https://vanhaven.ca"
                                    className="rounded-sm border border-ink/20 px-6 py-3 text-sm transition-colors hover:border-ink"
                                >
                                    About the practice
                                </a>
                            </div>
                        </div>

                        <PlanSketch />
                    </section>

                    <section className="border-t border-border bg-paper-warm">
                        <div className="mx-auto max-w-6xl px-6 py-16">
                            <p className="ax-eyebrow text-ink-muted">
                                What it does
                            </p>
                            <div className="mt-8 grid gap-x-10 gap-y-10 sm:grid-cols-2">
                                {CAPABILITIES.map((item) => (
                                    <div
                                        key={item.title}
                                        className="flex gap-4"
                                    >
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
                </main>

                <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-ink-muted">
                    <p>Axon — Vancouver, British Columbia</p>
                    <p>
                        Lengths held in millimetres, shown in your project
                        units.
                    </p>
                </footer>
            </div>
        </>
    );
}

/**
 * A miniature floor plan drawn in the same language as the editor: poché
 * walls, a door swing, a window and a dimension string.
 */
function PlanSketch() {
    return (
        <div className="rounded-lg border border-border bg-paper-warm p-4">
            <svg
                viewBox="0 0 420 320"
                className="w-full"
                role="img"
                aria-label="Floor plan sketch"
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
                            stroke="#e2dcd3"
                            strokeWidth="1"
                        />
                    </pattern>
                </defs>

                <rect width="420" height="320" fill="url(#ax-grid)" />

                {/* Exterior poché */}
                <path
                    d="M40 40h300v220H40z M56 56h268v188H56z"
                    fill="#cdc4b8"
                    fillRule="evenodd"
                    stroke="#3a3733"
                    strokeWidth="1.6"
                />

                {/* Interior partitions */}
                <path
                    d="M196 56h8v112h-8z"
                    fill="#ddd5ca"
                    stroke="#6c655d"
                    strokeWidth="1.1"
                />
                <path
                    d="M204 164h120v8H204z"
                    fill="#ddd5ca"
                    stroke="#6c655d"
                    strokeWidth="1.1"
                />

                {/* Door opening with swing */}
                <rect x="196" y="96" width="8" height="46" fill="#f7f5f2" />
                <path
                    d="M196 96v46"
                    stroke="#3a3733"
                    strokeWidth="1.2"
                    strokeDasharray="0"
                    fill="none"
                />
                <path d="M200 142 246 142" stroke="#242424" strokeWidth="1.4" />
                <path
                    d="M246 142A46 46 0 0 0 200 96"
                    fill="none"
                    stroke="#5b5550"
                    strokeWidth="0.9"
                />

                {/* Window in the south wall */}
                <rect x="96" y="244" width="84" height="16" fill="#f7f5f2" />
                <path
                    d="M96 248h84M96 252h84M96 256h84"
                    stroke="#8fb6c4"
                    strokeWidth="1.1"
                    fill="none"
                />
                <path
                    d="M96 244v16M180 244v16"
                    stroke="#3a3733"
                    strokeWidth="1.2"
                />

                {/* Room tags */}
                <text
                    x="126"
                    y="150"
                    textAnchor="middle"
                    className="fill-ink"
                    fontSize="13"
                    fontWeight="600"
                >
                    Living
                </text>
                <text
                    x="126"
                    y="166"
                    textAnchor="middle"
                    fill="#5b5550"
                    fontSize="10"
                >
                    32.58 m²
                </text>
                <text
                    x="264"
                    y="112"
                    textAnchor="middle"
                    className="fill-ink"
                    fontSize="13"
                    fontWeight="600"
                >
                    Bedroom
                </text>
                <text
                    x="264"
                    y="128"
                    textAnchor="middle"
                    fill="#5b5550"
                    fontSize="10"
                >
                    23.04 m²
                </text>

                {/* Dimension string */}
                <path d="M40 292h300" stroke="#2a6f8f" strokeWidth="0.9" />
                <path
                    d="M36 288l8 8M336 288l8 8M40 260v36M340 260v36"
                    stroke="#2a6f8f"
                    strokeWidth="0.9"
                />
                <rect x="164" y="282" width="52" height="16" fill="#f7f5f2" />
                <text
                    x="190"
                    y="294"
                    textAnchor="middle"
                    fill="#2a6f8f"
                    fontSize="11"
                    fontWeight="500"
                >
                    12,000
                </text>
            </svg>
        </div>
    );
}
