import { router, useHttp } from '@inertiajs/react';
import {
    AlertTriangle,
    Crosshair,
    Eraser,
    MapPin,
    Send,
    ShieldQuestion,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { surveyBuilding } from '@/lib/cad/survey';
import { cn } from '@/lib/utils';
import { place as placeRoute } from '@/routes/assistant';
import { reply as replyRoute } from '@/routes/projects/assistant';
import { update as saveJurisdiction } from '@/routes/projects/jurisdiction';

type Turn = { role: 'user' | 'assistant'; content: string };

type CodeAssistantDialogProps = {
    editor: CadEditor;
    projectId: number;
    /** Where the building is, as the project last recorded it. */
    jurisdiction: string | null;
    /** False until there is an OpenRouter key to reach the model with. */
    configured: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/**
 * Openers that show what this assistant is for: half about the drawing, half
 * about the code that governs it.
 */
const OPENERS = [
    'Are my exit doors wide enough?',
    'What fire separation do I need between the garage and the house?',
    'Check my stair against the code here.',
    'How much window area does a bedroom need for light and ventilation?',
];

export function CodeAssistantDialog({
    editor,
    projectId,
    jurisdiction,
    configured,
    open,
    onOpenChange,
}: CodeAssistantDialogProps) {
    const [turns, setTurns] = useState<Turn[]>([]);
    const [draft, setDraft] = useState('');
    const [failure, setFailure] = useState<string | null>(null);

    // Where the building is. Seeded from the project, then owned here so
    // answering the question once is enough for the rest of the session.
    const [place, setPlace] = useState(jurisdiction ?? '');
    const [changingPlace, setChangingPlace] = useState(false);

    // The survey is measured off the live document, so it includes work that
    // has not been saved yet.
    const survey = useMemo(
        () => surveyBuilding(editor.document),
        [editor.document],
    );

    const asking = place.trim() === '' || changingPlace;

    const { post, transform, processing } = useHttp<
        { messages: Turn[]; survey: string; jurisdiction: string },
        { reply: string }
    >({ messages: [], survey: '', jurisdiction: '' });

    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = scrollRef.current;

        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [turns.length, processing]);

    function ask(question: string) {
        const asked = question.trim();

        if (asked === '' || processing || !configured) {
            return;
        }

        const transcript: Turn[] = [...turns, { role: 'user', content: asked }];

        setTurns(transcript);
        setDraft('');
        setFailure(null);

        transform(() => ({
            messages: transcript,
            survey: survey.brief,
            jurisdiction: place.trim(),
        }));

        post(replyRoute.url({ project: projectId }), {
            onSuccess: (response) => {
                setTurns((current) => [
                    ...current,
                    { role: 'assistant', content: response.reply },
                ]);
            },
            onHttpException: (response) => {
                const body = response.data as { message?: string } | null;

                setFailure(
                    body?.message ??
                        'The assistant could not be reached. Try again in a moment.',
                );

                return false;
            },
            onNetworkError: () => {
                setFailure('No connection to the assistant.');

                return false;
            },
            onError: () => {
                setFailure(
                    'That question could not be sent. Try a shorter one.',
                );
            },
        }).catch(() => {
            // Already reported through the callbacks above.
        });
    }

    /** Take the answer to "where is this?" and remember it on the project. */
    function settle(next: string) {
        const trimmed = next.trim();

        setPlace(trimmed);
        setChangingPlace(false);

        router.put(
            saveJurisdiction.url({ project: projectId }),
            { jurisdiction: trimmed },
            { preserveScroll: true, preserveState: true },
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldQuestion className="size-4 text-sand" />
                        Ask about this building
                    </DialogTitle>
                    <DialogDescription>
                        Questions about what you have drawn, and about the
                        building and fire code where it is being built.
                    </DialogDescription>
                </DialogHeader>

                {!configured ? (
                    <NoKey />
                ) : asking ? (
                    <WhereIsIt
                        initial={place}
                        onSettle={settle}
                        onCancel={
                            place.trim() === ''
                                ? null
                                : () => setChangingPlace(false)
                        }
                    />
                ) : (
                    <>
                        <Where
                            place={place}
                            onChange={() => setChangingPlace(true)}
                        />

                        {survey.facts.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {survey.facts.map((fact) => (
                                    <span
                                        key={fact}
                                        className="rounded-full border border-border px-2 py-0.5 text-[0.68rem] text-muted-foreground"
                                    >
                                        {fact}
                                    </span>
                                ))}
                            </div>
                        )}

                        <div
                            ref={scrollRef}
                            className="min-h-64 flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-muted/20 px-4 py-4"
                        >
                            {turns.length === 0 ? (
                                <Openers onPick={ask} empty={survey.empty} />
                            ) : (
                                turns.map((turn, index) => (
                                    <Bubble
                                        key={`${index}-${turn.role}`}
                                        turn={turn}
                                    />
                                ))
                            )}

                            {processing && <Thinking />}

                            {failure && (
                                <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                    {failure}
                                </p>
                            )}
                        </div>

                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                ask(draft);
                            }}
                            className="flex items-end gap-2"
                        >
                            <textarea
                                rows={1}
                                value={draft}
                                placeholder="Ask about the drawing, or about the code here…"
                                onChange={(event) =>
                                    setDraft(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (
                                        event.key === 'Enter' &&
                                        !event.shiftKey
                                    ) {
                                        event.preventDefault();
                                        ask(draft);
                                    }
                                }}
                                className="max-h-32 min-h-9 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring"
                            />

                            {turns.length > 0 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    title="Start over"
                                    onClick={() => {
                                        setTurns([]);
                                        setFailure(null);
                                    }}
                                >
                                    <Eraser className="size-4" />
                                </Button>
                            )}

                            <Button
                                type="submit"
                                size="sm"
                                disabled={processing}
                            >
                                <Send className="size-4" />
                                Ask
                            </Button>
                        </form>

                        <p className="text-[0.68rem] text-muted-foreground">
                            Answers are a starting point, not a ruling. Confirm
                            anything that matters with your authority having
                            jurisdiction.
                        </p>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

/* -------------------------------------------------------------- the place */

/**
 * The question asked before the first answer: code depends entirely on where
 * the building is, so there is no useful reply until this is settled.
 */
function WhereIsIt({
    initial,
    onSettle,
    onCancel,
}: {
    initial: string;
    onSettle: (place: string) => void;
    onCancel: (() => void) | null;
}) {
    const [typed, setTyped] = useState(initial);
    const [locating, setLocating] = useState(false);
    const [trouble, setTrouble] = useState<string | null>(null);

    const { post, transform } = useHttp<
        { latitude: number; longitude: number },
        { place: string }
    >({ latitude: 0, longitude: 0 });

    /** Ask the browser where we are, then turn that into a place name. */
    function locate() {
        if (!navigator.geolocation) {
            setTrouble(
                'This browser cannot share a location. Type it instead.',
            );

            return;
        }

        setTrouble(null);
        setLocating(true);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                transform(() => ({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                }));

                post(placeRoute.url(), {
                    onSuccess: (response) => {
                        setTyped(response.place);
                        setLocating(false);
                    },
                    onHttpException: (response) => {
                        const body = response.data as {
                            message?: string;
                        } | null;

                        setTrouble(
                            body?.message ??
                                'Could not name that location. Type it instead.',
                        );
                        setLocating(false);

                        return false;
                    },
                    onNetworkError: () => {
                        setTrouble('No connection to look that up.');
                        setLocating(false);

                        return false;
                    },
                }).catch(() => {
                    setLocating(false);
                });
            },
            () => {
                setTrouble(
                    'Location was refused. Type the city and country instead.',
                );
                setLocating(false);
            },
            { timeout: 10_000, maximumAge: 600_000 },
        );
    }

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();

                if (typed.trim() !== '') {
                    onSettle(typed);
                }
            }}
            className="space-y-4 rounded-lg border border-border bg-muted/20 p-5"
        >
            <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                    <MapPin className="size-4 text-sand" />
                    Where is this building?
                </p>
                <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">
                    Building and fire code is written province by province and
                    city by city, so an answer is only worth anything once I
                    know where you are building. Give the city, the province or
                    state, and the country.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="Kelowna, British Columbia, Canada"
                    autoFocus
                    className="min-w-64 flex-1"
                />

                <Button
                    type="button"
                    variant="outline"
                    onClick={locate}
                    disabled={locating}
                >
                    <Crosshair className="size-4" />
                    {locating ? 'Locating…' : 'Use my location'}
                </Button>

                <Button type="submit" disabled={typed.trim() === ''}>
                    Start asking
                </Button>

                {onCancel && (
                    <Button type="button" variant="ghost" onClick={onCancel}>
                        Cancel
                    </Button>
                )}
            </div>

            {trouble && (
                <p className="flex items-start gap-2 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {trouble}
                </p>
            )}

            <p className="text-[0.68rem] text-muted-foreground">
                This is saved with the project, so you are only asked once. It
                is also on the Project Information dialog if you want to change
                it later.
            </p>
        </form>
    );
}

function Where({ place, onChange }: { place: string; onChange: () => void }) {
    return (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="size-3.5 text-sand" />
            Answering under the code in force in
            <span className="font-medium text-foreground">{place}</span>
            <button
                type="button"
                onClick={onChange}
                className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
                change
            </button>
        </p>
    );
}

/* --------------------------------------------------------------- speaking */

function Bubble({ turn }: { turn: Turn }) {
    const mine = turn.role === 'user';

    return (
        <div
            className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}
        >
            {!mine && (
                <p className="mb-1 ml-1 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                    <ShieldQuestion className="size-3" />
                    Code consultant
                </p>
            )}

            <div
                className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                    mine
                        ? 'bg-ink text-paper dark:bg-sand dark:text-ink'
                        : 'bg-card text-foreground',
                )}
            >
                {turn.content}
            </div>
        </div>
    );
}

function Thinking() {
    return (
        <div className="flex items-center gap-1.5 pl-1">
            {[0, 150, 300].map((delay) => (
                <span
                    key={delay}
                    style={{ animationDelay: `${delay}ms` }}
                    className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60"
                />
            ))}
        </div>
    );
}

function Openers({
    onPick,
    empty,
}: {
    onPick: (question: string) => void;
    empty: boolean;
}) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 py-6">
            <p className="max-w-md text-center text-sm text-muted-foreground">
                {empty
                    ? 'Nothing is drawn yet, so I can only answer in general terms. Ask away.'
                    : 'I have read the drawing. Ask about it, or about the code that governs it.'}
            </p>

            <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {OPENERS.map((opener) => (
                    <button
                        key={opener}
                        type="button"
                        onClick={() => onPick(opener)}
                        className="rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
                    >
                        {opener}
                    </button>
                ))}
            </div>
        </div>
    );
}

function NoKey() {
    return (
        <div className="rounded-lg border border-border bg-muted/40 p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="size-4" />
                No API key yet
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
                Create a free key at{' '}
                <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                >
                    openrouter.ai/keys
                </a>
                , put it in <span className="font-mono">.env</span> as{' '}
                <span className="font-mono">OPENROUTER_API_KEY</span>, then
                restart the server.
            </p>
        </div>
    );
}
