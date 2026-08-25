import { Head, useHttp } from '@inertiajs/react';
import { AlertTriangle, Eraser, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { assistant } from '@/routes';
import { reply } from '@/routes/assistant';

type Turn = {
    role: 'user' | 'assistant';
    content: string;
};

type AssistantPageProps = {
    /** False until an OPENROUTER_API_KEY is in the environment. */
    configured: boolean;
};

/**
 * Openers for an empty conversation. Deliberately not all about drafting —
 * this is the general-questions companion.
 */
const OPENERS = [
    'Explain the difference between a section and an elevation.',
    'What should I check before pouring a slab on grade?',
    'Give me three names for a laneway house project.',
    'How does an axonometric projection actually work?',
];

export default function Assistant({ configured }: AssistantPageProps) {
    const [turns, setTurns] = useState<Turn[]>([]);
    const [draft, setDraft] = useState('');
    const [failure, setFailure] = useState<string | null>(null);

    // The transcript lives in React state; transform hands the current one to
    // the request, since setData would not have landed by the time we post.
    const { post, transform, processing } = useHttp<
        { messages: Turn[] },
        { reply: string }
    >({ messages: [] });

    const scrollRef = useRef<HTMLDivElement>(null);

    // Follow the conversation down as it grows.
    useEffect(() => {
        const container = scrollRef.current;

        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [turns.length, processing]);

    function ask(question: string) {
        const asked = question.trim();

        if (asked === '' || processing) {
            return;
        }

        const transcript: Turn[] = [...turns, { role: 'user', content: asked }];

        setTurns(transcript);
        setDraft('');
        setFailure(null);

        transform(() => ({ messages: transcript }));

        post(reply.url(), {
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
                setFailure(
                    'No connection to the assistant. Check your network.',
                );

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

    return (
        <>
            <Head title="Assistant" />

            <div className="flex h-full flex-1 flex-col gap-6 p-6">
                <header className="border-b border-border pb-5">
                    <p className="ax-eyebrow text-muted-foreground">Axon</p>
                    <h1 className="mt-2 text-2xl font-light tracking-tight">
                        Assistant
                    </h1>
                    <div className="ax-rule mt-3" />
                    <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                        Ask anything — drafting, construction, or something with
                        nothing to do with either.
                    </p>
                </header>

                {!configured && <NotConfigured />}

                <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
                    <div className="flex items-center justify-between border-b border-border px-5 py-3">
                        <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                            Conversation
                        </p>

                        {turns.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setTurns([]);
                                    setFailure(null);
                                }}
                                className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <Eraser className="size-3.5" />
                                Start over
                            </button>
                        )}
                    </div>

                    <div
                        ref={scrollRef}
                        className="min-h-72 flex-1 space-y-4 overflow-y-auto px-5 py-5"
                    >
                        {turns.length === 0 ? (
                            <Openers onPick={ask} disabled={!configured} />
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
                        className="flex items-end gap-2 border-t border-border p-3"
                    >
                        <textarea
                            rows={1}
                            value={draft}
                            disabled={!configured}
                            placeholder={
                                configured
                                    ? 'Ask anything…'
                                    : 'Add an API key to start asking'
                            }
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                // Enter sends, Shift+Enter starts a new line.
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    ask(draft);
                                }
                            }}
                            className="max-h-40 min-h-9 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring disabled:opacity-60"
                        />
                        <Button
                            type="submit"
                            size="sm"
                            disabled={processing || !configured}
                        >
                            <Send className="size-4" />
                            Ask
                        </Button>
                    </form>
                </section>
            </div>
        </>
    );
}

/* -------------------------------------------------------------- transcript */

function Bubble({ turn }: { turn: Turn }) {
    const mine = turn.role === 'user';

    return (
        <div
            className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}
        >
            {!mine && (
                <p className="mb-1 ml-1 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                    <Sparkles className="size-3" />
                    Assistant
                </p>
            )}

            <div
                className={cn(
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                    mine
                        ? 'bg-ink text-paper dark:bg-sand dark:text-ink'
                        : 'bg-muted text-foreground',
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
    disabled,
}: {
    onPick: (question: string) => void;
    disabled: boolean;
}) {
    return (
        <div className="flex h-full flex-col items-center justify-center gap-5 py-10">
            <Sparkles className="size-6 text-muted-foreground" />
            <p className="max-w-sm text-center text-sm text-muted-foreground">
                Nothing asked yet. Pick one of these or type your own.
            </p>

            <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {OPENERS.map((opener) => (
                    <button
                        key={opener}
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(opener)}
                        className="rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    >
                        {opener}
                    </button>
                ))}
            </div>
        </div>
    );
}

function NotConfigured() {
    return (
        <div className="rounded-lg border border-border bg-muted/40 p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="size-4" />
                No API key yet
            </p>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Create a free key at{' '}
                <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-4"
                >
                    openrouter.ai/keys
                </a>
                , put it in your <span className="font-mono">.env</span> as{' '}
                <span className="font-mono">OPENROUTER_API_KEY</span>, then
                restart the server. The default model costs nothing to use.
            </p>
        </div>
    );
}

Assistant.layout = {
    breadcrumbs: [
        {
            title: 'Assistant',
            href: assistant(),
        },
    ],
};
