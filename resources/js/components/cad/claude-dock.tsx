import { useHttp } from '@inertiajs/react';
import {
    CornerDownLeft,
    Hammer,
    Loader2,
    MessageCircle,
    PanelRightClose,
    Plug,
    Sparkles,
    Unplug,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PanelHeading } from '@/components/cad/project-browser';
import { ClaudeSignIn } from '@/components/claude-sign-in';
import type { ClaudeState } from '@/components/claude-sign-in';
import type { CadEditor } from '@/hooks/use-cad-editor';
import { isCadDocument } from '@/lib/cad/transfer';
import type { CadDocument } from '@/lib/cad/types';
import { cn } from '@/lib/utils';
import { claude as claudeRoute } from '@/routes/projects';

/**
 * Asking about the drawing, or having it drawn.
 *
 * The whole difference is which tools the turn is given, and that is decided
 * on the server — Ask cannot draw however it is asked to.
 */
type Mode = 'ask' | 'build';

type Line = {
    id: number;
    role: 'you' | 'claude' | 'note';
    text: string;
    /** What actually changed in the model, read off the drawing itself. */
    changes?: string[];
};

type Reply = {
    text: string;
    session: string | null;
    changes: string[];
    document: CadDocument | null;
};

type ClaudeDockProps = {
    editor: CadEditor;
    projectId: number;
    /** Whether the CLI is here, and whether this person has signed in to it. */
    claude: ClaudeState;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

const OPENERS: Record<Mode, string[]> = {
    ask: [
        'What is in this model so far?',
        'How much wall have I drawn, by type?',
        'Which rooms have no window?',
    ],
    build: [
        'Draw a 6000 by 4000 room in the top left corner.',
        'Put a door in the middle of the longest wall.',
        'Add a second storey at 2700.',
    ],
};

/**
 * Claude, sitting beside the drawing.
 *
 * The sidebar is not a chat box wired to a text model: the turn runs Claude
 * Code on this machine with Vanhaven's own MCP server attached, so it holds
 * the same tools an outside client would — read the document, draw walls,
 * place openings and rooms, add a level.
 *
 * It runs as you. A turn is drawn from the Claude subscription you signed in
 * with, never the machine owner's and never a colleague's, which is why the
 * dock asks you to connect an account before it will do anything at all.
 *
 * Building lends the live drawing up with the question. That matters: the
 * model lives in this browser, so the copy on the server is only a preview
 * and building on it would quietly throw the work away. What comes back is
 * committed as one entry, so a turn you did not want is one undo.
 */
export function ClaudeDock({
    editor,
    projectId,
    claude,
    open,
    onOpenChange,
}: ClaudeDockProps) {
    // Both halves have to be true before a turn can be taken at all.
    const ready = claude.installed && claude.signedIn;

    const [lines, setLines] = useState<Line[]>([]);
    const [draft, setDraft] = useState('');
    const [mode, setMode] = useState<Mode>('ask');
    const [session, setSession] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    /**
     * A drawing Claude finished after the person had moved on and changed
     * something themselves. Held rather than applied, because committing it
     * would take their work with it.
     */
    const [stale, setStale] = useState<CadDocument | null>(null);

    const nextId = useRef(1);
    const scroller = useRef<HTMLDivElement>(null);

    const { post, transform, processing } = useHttp<
        {
            prompt: string;
            mode: Mode;
            session: string | null;
            document: CadDocument | null;
        },
        Reply
    >({ prompt: '', mode: 'ask', session: null, document: null });

    useEffect(() => {
        const box = scroller.current;

        if (box) {
            box.scrollTop = box.scrollHeight;
        }
    }, [lines.length, processing]);

    function say(line: Omit<Line, 'id'>) {
        setLines((current) => [...current, { id: nextId.current++, ...line }]);
    }

    function send(question: string) {
        const asked = question.trim();

        if (asked === '' || processing || !ready) {
            return;
        }

        const building = mode === 'build';
        // Remembered from before the turn: it takes long enough that somebody
        // can draw a wall of their own while they wait.
        const revision = editor.store.revision;

        say({ role: 'you', text: asked });
        setDraft('');
        setFailure(null);
        setStale(null);

        transform(() => ({
            prompt: asked,
            mode,
            session,
            document: building ? editor.document : null,
        }));

        post(claudeRoute.url({ project: projectId }), {
            onSuccess: (reply) => {
                setSession(reply.session);
                say({
                    role: 'claude',
                    text: reply.text,
                    changes: reply.changes,
                });

                const drawn = reply.document;

                if (drawn === null || !isCadDocument(drawn)) {
                    return;
                }

                if (editor.store.revision !== revision) {
                    setStale(drawn);

                    return;
                }

                adopt(drawn);
            },
            onHttpException: (response) => {
                const body = response.data as { message?: string } | null;

                setFailure(
                    body?.message ??
                        'Claude could not be reached. Try again in a moment.',
                );

                return false;
            },
            onNetworkError: () => {
                setFailure('No connection to Claude.');

                return false;
            },
            onError: () => {
                setFailure('That could not be sent. Try a shorter message.');
            },
        }).catch(() => {
            // Already reported through the callbacks above.
        });
    }

    /** Take the drawing Claude worked on, as a single undoable change. */
    function adopt(drawn: CadDocument) {
        editor.clearSelection();
        editor.store.commit('Claude', () => drawn);
        editor.setStatus('Claude changed the drawing — Ctrl+Z to put it back');
        setStale(null);
    }

    if (!open) {
        return <Rail onOpen={() => onOpenChange(true)} />;
    }

    return (
        <aside className="flex w-[22rem] shrink-0 flex-col border-l border-chrome-border bg-chrome text-chrome-fg">
            <PanelHeading>
                <span className="flex items-center gap-1.5">
                    <Sparkles className="size-3 text-sand" />
                    Claude
                </span>
            </PanelHeading>

            <div className="flex shrink-0 items-center justify-between border-b border-chrome-border px-3 py-2">
                <Connection ready={ready} mode={mode} />

                <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    title="Close the sidebar"
                    className="rounded-sm p-1 text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-fg"
                >
                    <PanelRightClose className="size-3.5" />
                </button>
            </div>

            <ModeSwitch mode={mode} onChange={setMode} disabled={processing} />

            <div
                ref={scroller}
                className="min-h-0 flex-1 scrollbar-chrome space-y-3 overflow-y-auto bg-chrome-sunken px-3 py-3 text-[0.78rem]"
            >
                {!ready && <ClaudeSignIn claude={claude} />}

                {ready && lines.length === 0 && (
                    <Openers mode={mode} onPick={send} />
                )}

                {lines.map((line) => (
                    <Spoken key={line.id} line={line} />
                ))}

                {processing && <Working mode={mode} />}

                {stale !== null && (
                    <Held
                        onApply={() => adopt(stale)}
                        onDrop={() => setStale(null)}
                    />
                )}

                {failure !== null && (
                    <p className="rounded-sm border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[0.73rem] text-destructive">
                        {failure}
                    </p>
                )}
            </div>

            <Composer
                draft={draft}
                mode={mode}
                disabled={!ready || processing}
                onChange={setDraft}
                onSend={() => send(draft)}
            />
        </aside>
    );
}

/**
 * The closed sidebar: a tab down the right edge, so the dock costs nothing
 * when it is not wanted but is never more than one click away.
 */
function Rail({ onOpen }: { onOpen: () => void }) {
    return (
        <aside className="flex w-9 shrink-0 flex-col items-center border-l border-chrome-border bg-chrome py-2">
            <button
                type="button"
                onClick={onOpen}
                title="Ask Claude about this drawing"
                className="group flex flex-1 flex-col items-center gap-2 rounded-sm px-1 py-2 text-chrome-muted transition-colors hover:bg-chrome-raised hover:text-chrome-fg"
            >
                <Sparkles className="size-4 shrink-0 text-sand" />
                <span className="ax-eyebrow text-[0.58rem] [writing-mode:vertical-rl]">
                    Claude
                </span>
            </button>
        </aside>
    );
}

/** Whether there is anything on the other end, and what it is holding. */
function Connection({ ready, mode }: { ready: boolean; mode: Mode }) {
    const tools = mode === 'build' ? 10 : 4;

    return (
        <span
            className={cn(
                'flex items-center gap-1.5 text-[0.68rem]',
                ready ? 'text-chrome-muted' : 'text-destructive',
            )}
        >
            {ready ? (
                <Plug className="size-3 text-sand" />
            ) : (
                <Unplug className="size-3" />
            )}
            {ready ? `MCP · ${tools} tools` : 'Not connected'}
        </span>
    );
}

function ModeSwitch({
    mode,
    onChange,
    disabled,
}: {
    mode: Mode;
    onChange: (mode: Mode) => void;
    disabled: boolean;
}) {
    const options: { value: Mode; label: string; hint: string }[] = [
        {
            value: 'ask',
            label: 'Ask',
            hint: 'Look and answer. Nothing changes.',
        },
        {
            value: 'build',
            label: 'Build',
            hint: 'Draw in the model. One undo puts it back.',
        },
    ];

    return (
        <div className="flex shrink-0 gap-1 border-b border-chrome-border p-2">
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    title={option.hint}
                    onClick={() => onChange(option.value)}
                    className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-[0.72rem] transition-colors disabled:opacity-50',
                        mode === option.value
                            ? 'border-sand/60 bg-sand/15 text-sand'
                            : 'border-transparent text-chrome-muted hover:bg-chrome-raised hover:text-chrome-fg',
                    )}
                >
                    {option.value === 'ask' ? (
                        <MessageCircle className="size-3" />
                    ) : (
                        <Hammer className="size-3" />
                    )}
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function Spoken({ line }: { line: Line }) {
    if (line.role === 'you') {
        return (
            <p className="ml-6 rounded-sm rounded-br-none bg-chrome-raised px-2.5 py-1.5 text-right whitespace-pre-wrap text-chrome-fg">
                {line.text}
            </p>
        );
    }

    return (
        <div className="mr-4 space-y-1.5">
            <p className="border-l-2 border-sand/50 pl-2.5 whitespace-pre-wrap text-chrome-fg">
                {line.text}
            </p>

            {line.changes !== undefined && line.changes.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-2.5">
                    {line.changes.map((change) => (
                        <span
                            key={change}
                            className="rounded-full bg-sand/15 px-2 py-0.5 text-[0.66rem] text-sand"
                        >
                            {change}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function Working({ mode }: { mode: Mode }) {
    return (
        <p className="flex items-center gap-2 pl-2.5 text-[0.72rem] text-chrome-muted">
            <Loader2 className="size-3 animate-spin text-sand" />
            {mode === 'build' ? 'Drawing…' : 'Reading the model…'}
        </p>
    );
}

/**
 * Claude finished, but the drawing moved underneath it. Applying now would
 * take whatever was drawn in the meantime with it, so it is offered instead.
 */
function Held({
    onApply,
    onDrop,
}: {
    onApply: () => void;
    onDrop: () => void;
}) {
    return (
        <div className="space-y-2 rounded-sm border border-sand/40 bg-sand/10 px-2.5 py-2">
            <p className="text-[0.72rem] text-chrome-fg">
                You changed the drawing while Claude was working. Applying this
                will replace what you drew since.
            </p>

            <div className="flex gap-1.5">
                <button
                    type="button"
                    onClick={onApply}
                    className="rounded-sm border border-sand/60 bg-sand/20 px-2 py-1 text-[0.7rem] text-sand transition-colors hover:bg-sand/30"
                >
                    Apply anyway
                </button>
                <button
                    type="button"
                    onClick={onDrop}
                    className="rounded-sm px-2 py-1 text-[0.7rem] text-chrome-muted transition-colors hover:text-chrome-fg"
                >
                    Keep mine
                </button>
            </div>
        </div>
    );
}

function Openers({
    mode,
    onPick,
}: {
    mode: Mode;
    onPick: (question: string) => void;
}) {
    return (
        <div className="space-y-2">
            <p className="text-[0.72rem] leading-relaxed text-chrome-muted">
                {mode === 'build'
                    ? 'Claude has the drawing tools. Say what you want built and it appears in the model.'
                    : 'Claude can read this model. Ask about what is in it.'}
            </p>

            {OPENERS[mode].map((opener) => (
                <button
                    key={opener}
                    type="button"
                    onClick={() => onPick(opener)}
                    className="block w-full rounded-sm border border-chrome-border px-2.5 py-1.5 text-left text-[0.73rem] text-chrome-muted transition-colors hover:border-sand/50 hover:text-chrome-fg"
                >
                    {opener}
                </button>
            ))}
        </div>
    );
}

function Composer({
    draft,
    mode,
    disabled,
    onChange,
    onSend,
}: {
    draft: string;
    mode: Mode;
    disabled: boolean;
    onChange: (value: string) => void;
    onSend: () => void;
}) {
    return (
        <div className="shrink-0 border-t border-chrome-border p-2">
            <textarea
                value={draft}
                rows={3}
                disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        onSend();
                    }
                }}
                placeholder={
                    mode === 'build'
                        ? 'Describe what to draw…'
                        : 'Ask about this model…'
                }
                className="w-full resize-none rounded-sm border border-chrome-border bg-chrome-sunken px-2.5 py-1.5 text-[0.78rem] text-chrome-fg placeholder:text-chrome-muted focus:border-sand/60 focus:outline-none disabled:opacity-50"
            />

            <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[0.63rem] text-chrome-muted">
                    Enter to send · Shift+Enter for a new line
                </span>

                <button
                    type="button"
                    disabled={disabled || draft.trim() === ''}
                    onClick={onSend}
                    className="flex items-center gap-1.5 rounded-sm border border-sand/60 bg-sand/15 px-2.5 py-1 text-[0.72rem] text-sand transition-colors hover:bg-sand/25 disabled:opacity-40 disabled:hover:bg-sand/15"
                >
                    <CornerDownLeft className="size-3" />
                    Send
                </button>
            </div>
        </div>
    );
}
