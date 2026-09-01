import { Form, Head, Link, router, usePage } from '@inertiajs/react';
import { Clock, Footprints, LogOut, MapPin, MessageSquare } from 'lucide-react';
import { useMemo } from 'react';
import AppLogoIcon from '@/components/app-logo-icon';
import { buildPlanModel, PlanThumbnail } from '@/components/cad/plan-thumbnail';
import type { PlanModel } from '@/components/cad/plan-thumbnail';
import { Button } from '@/components/ui/button';
import type { CadDocument, Units } from '@/lib/cad/types';
import { formatArea } from '@/lib/cad/units';
import { formatDuration, formatRelativeDay } from '@/lib/duration';
import { leave, tour } from '@/routes/portal';
import { store as storeComment } from '@/routes/portal/comments';

type SharedProps = {
    name: string;
};

type Comment = {
    id: number;
    body: string;
    created_at: string | null;
};

type Drawing = {
    id: number;
    name: string;
    number: string | null;
    address: string | null;
    units: Units;
    worked_seconds: number;
    worked_at: string | null;
    summary: {
        levels: number;
        walls: number;
        rooms: number;
        openings: number;
        slabArea: number;
    };
    preview: CadDocument | null;
    comments: Comment[];
};

type PortalProps = {
    client: { name: string; username: string | null };
    drawings: Drawing[];
    total_seconds: number;
};

export default function PortalShow({
    client,
    drawings,
    total_seconds,
}: PortalProps) {
    const { name } = usePage<SharedProps>().props;

    const plans = useMemo(
        () =>
            new Map<number, PlanModel | null>(
                drawings.map((drawing) => [
                    drawing.id,
                    buildPlanModel(drawing.preview),
                ]),
            ),
        [drawings],
    );

    const lastWorked = drawings
        .map((drawing) => drawing.worked_at)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1);

    return (
        <>
            <Head title="Your project" />

            <div className="min-h-svh bg-background">
                <header className="border-b border-border">
                    <div className="mx-auto flex max-w-4xl items-center gap-3 px-6 py-4">
                        <div className="flex size-8 items-center justify-center rounded-sm border border-sand/40 text-sand">
                            <AppLogoIcon className="size-5 fill-current" />
                        </div>

                        <div className="grid flex-1 leading-none">
                            <span className="text-sm font-semibold tracking-[0.2em]">
                                {name}
                            </span>
                            <span className="ax-eyebrow mt-1.5 text-[0.6rem] text-sand">
                                Client portal
                            </span>
                        </div>

                        <span className="hidden text-sm text-muted-foreground sm:inline">
                            {client.username}
                        </span>

                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.post(leave().url)}
                        >
                            <LogOut className="size-4" />
                            Sign out
                        </Button>
                    </div>
                </header>

                <main className="mx-auto max-w-4xl px-6 py-10">
                    <h1 className="text-2xl font-medium">
                        Good to see you, {client.name}
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {drawings.length === 0
                            ? 'Your architect has not put a drawing on your file yet.'
                            : `${formatDuration(total_seconds)} of drawing time so far, last worked on ${formatRelativeDay(lastWorked ?? null)}.`}
                    </p>

                    <div className="mt-8 space-y-8">
                        {drawings.map((drawing) => (
                            <article
                                key={drawing.id}
                                className="overflow-hidden rounded-lg border border-border"
                            >
                                <div className="grid gap-6 p-6 sm:grid-cols-[14rem_1fr]">
                                    <div>
                                        <Link
                                            href={tour(drawing.id)}
                                            className="block aspect-[4/3] overflow-hidden rounded-md border border-border bg-paper-warm p-2 transition-colors hover:border-sand"
                                        >
                                            <PlanThumbnail
                                                model={
                                                    plans.get(drawing.id) ??
                                                    null
                                                }
                                                className="size-full"
                                            />
                                        </Link>

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-2 w-full"
                                            asChild
                                        >
                                            <Link href={tour(drawing.id)}>
                                                <Footprints className="size-4" />
                                                See it in 3D
                                            </Link>
                                        </Button>
                                    </div>

                                    <div>
                                        <h2 className="text-lg font-medium">
                                            {drawing.name}
                                        </h2>

                                        {drawing.number && (
                                            <p className="ax-eyebrow mt-1 text-muted-foreground">
                                                {drawing.number}
                                            </p>
                                        )}

                                        {drawing.address && (
                                            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <MapPin className="size-3.5" />
                                                {drawing.address}
                                            </p>
                                        )}

                                        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                                            <Figure
                                                label="Levels"
                                                value={String(
                                                    drawing.summary.levels,
                                                )}
                                            />
                                            <Figure
                                                label="Rooms"
                                                value={String(
                                                    drawing.summary.rooms,
                                                )}
                                            />
                                            <Figure
                                                label="Doors & windows"
                                                value={String(
                                                    drawing.summary.openings,
                                                )}
                                            />
                                            <Figure
                                                label="Floor area"
                                                value={formatArea(
                                                    drawing.summary.slabArea,
                                                    drawing.units,
                                                )}
                                            />
                                        </dl>

                                        <p className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
                                            <Clock className="size-3.5" />
                                            {formatDuration(
                                                drawing.worked_seconds,
                                            )}{' '}
                                            of drawing time · worked on{' '}
                                            {formatRelativeDay(
                                                drawing.worked_at,
                                            )}
                                        </p>
                                    </div>
                                </div>

                                <Comments drawing={drawing} />
                            </article>
                        ))}
                    </div>

                    <p className="mt-10 text-center text-xs text-muted-foreground">
                        This is a read-only view of your drawings. Anything you
                        write here goes to your architect.
                    </p>
                </main>
            </div>
        </>
    );
}

function Figure({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="ax-eyebrow text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-medium">{value}</dd>
        </div>
    );
}

function Comments({ drawing }: { drawing: Drawing }) {
    return (
        <section className="border-t border-border bg-muted/30 px-6 py-5">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <MessageSquare className="size-4" />
                Your comments
                {drawing.comments.length > 0 && (
                    <span className="text-muted-foreground">
                        ({drawing.comments.length})
                    </span>
                )}
            </h3>

            {drawing.comments.length > 0 && (
                <ul className="mt-4 space-y-3">
                    {drawing.comments.map((comment) => (
                        <li
                            key={comment.id}
                            className="rounded-md border border-border bg-background p-3"
                        >
                            <p className="text-sm whitespace-pre-wrap">
                                {comment.body}
                            </p>
                            <p className="mt-2 text-xs text-muted-foreground">
                                {formatRelativeDay(comment.created_at)}
                            </p>
                        </li>
                    ))}
                </ul>
            )}

            <Form
                {...storeComment.form()}
                resetOnSuccess
                className="mt-4 space-y-3"
            >
                {({ processing, errors }) => (
                    <>
                        <input
                            type="hidden"
                            name="project_id"
                            value={drawing.id}
                        />

                        <textarea
                            name="body"
                            required
                            rows={3}
                            maxLength={2000}
                            placeholder={`Anything you want changed or explained about ${drawing.name}?`}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring"
                        />

                        {errors.body && (
                            <p className="text-sm text-destructive">
                                {errors.body}
                            </p>
                        )}

                        <Button
                            type="submit"
                            size="sm"
                            disabled={processing}
                            className="w-full sm:w-auto"
                        >
                            Send to my architect
                        </Button>
                    </>
                )}
            </Form>
        </section>
    );
}
