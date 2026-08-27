import { Form, router, useHttp } from '@inertiajs/react';
import { Plug, Unplug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ItemPart } from '@/lib/cad/library';
import { cn } from '@/lib/utils';
import {
    destroy as disconnect,
    store as connect,
} from '@/routes/ai-connections';
import {
    board as boardRoute,
    claude as claudeRoute,
    terminal as terminalRoute,
} from '@/routes/library';

export type AiConnectionSummary = {
    id: number;
    provider: string;
    label: string;
    model: string;
};

type DesignTerminalProps = {
    connections: AiConnectionSummary[];
    /** True when Claude Code on this machine can answer in the page. */
    claudeCodeReady: boolean;
    /** The parts on the board right now. */
    parts: ItemPart[];
    /** The AI changed the board: parts to load, names when offered. */
    onDraft: (
        parts: ItemPart[],
        name: string | null,
        category: string | null,
    ) => void;
};

type Line = {
    id: number;
    kind: 'you' | 'ai' | 'note' | 'error' | 'warn' | 'good';
    text: string;
};

type Turn = { role: 'user' | 'assistant'; content: string };

/** How often the bridge asks whether Claude Code has touched the board. */
const POLL_MS = 2000;

const PROVIDERS = [
    {
        value: 'anthropic',
        label: 'Claude',
        command: 'claude',
        keyHint: 'sk-ant-…',
        modelHint: 'claude-sonnet-5',
    },
    {
        value: 'openai',
        label: 'OpenAI',
        command: 'openai',
        keyHint: 'sk-…',
        modelHint: 'gpt-5-mini',
    },
    {
        value: 'openrouter',
        label: 'OpenRouter',
        command: 'openrouter',
        keyHint: 'sk-or-…',
        modelHint: 'any model on openrouter.ai',
    },
] as const;

const SHELL_HELP = [
    'claude        talk to Claude here — your plan, no API charges',
    'claude --api  use a Claude API key instead (billed per token)',
    'openai        OpenAI at the board, by API key',
    'openrouter    OpenRouter at the board, by API key',
    'bridge        watch a board you drive from your own Claude Code window',
    'connect       manage API keys',
    'clear         clear the screen',
].join('\n');

const SESSION_HELP = [
    '/help        these commands',
    '/parts       print the board',
    '/clear       clear the scrollback, keep the board',
    '/connect     manage API accounts',
    '/exit        back to the shell',
    'anything else goes to the AI.',
].join('\n');

const BRIDGE_HELP = [
    '/help        these commands',
    '/parts       print the board',
    '/clear       clear the scrollback',
    '/exit        stop the bridge',
    'anything else is left for Claude Code to read next time it',
    'looks at the board. Mostly you will type in Claude Code itself.',
].join('\n');

let lineCounter = 0;

function line(kind: Line['kind'], text: string): Line {
    lineCounter += 1;

    return { id: lineCounter, kind, text };
}

function describeParts(parts: ItemPart[]): string {
    return parts.length === 0
        ? 'the board is empty'
        : parts
              .map(
                  (part, index) =>
                      `${index + 1}. ${part.name} — ${part.shape} ${Math.round(part.width)}×${Math.round(part.depth)}×${Math.round(part.height)} @ (${Math.round(part.x)}, ${Math.round(part.y)}, ${Math.round(part.z)})`,
              )
              .join('\n');
}

/**
 * The terminal on the designer page.
 *
 * `claude` opens a bridge to Claude Code running on this computer, which
 * works the board over MCP on the person's own subscription — no API charges
 * at all. `claude --api`, `openai` and `openrouter` are the paid, in-page
 * sessions for anyone who would rather use a key.
 */
export function DesignTerminal({
    connections,
    claudeCodeReady,
    parts,
    onDraft,
}: DesignTerminalProps) {
    const [stage, setStage] = useState<
        'shell' | 'session' | 'bridge' | 'claude'
    >('shell');
    const [running, setRunning] = useState<string | null>(null);
    const [bridged, setBridged] = useState(false);
    const [claudeSession, setClaudeSession] = useState<string | null>(null);
    const [thinking, setThinking] = useState(false);
    const [lines, setLines] = useState<Line[]>([]);
    const [transcript, setTranscript] = useState<Turn[]>([]);
    const [input, setInput] = useState('');
    const [connecting, setConnecting] = useState(false);

    const active =
        connections.find((connection) => connection.provider === running) ??
        null;

    const scrollback = useRef<HTMLDivElement>(null);
    const promptInput = useRef<HTMLInputElement>(null);

    // Bridge bookkeeping, all in refs so the poll never restarts itself.
    const lastRevision = useRef(0);
    const published = useRef('');
    const adopting = useRef(false);
    const claimed = useRef(false);
    const draftRef = useRef(onDraft);
    const partsRef = useRef(parts);

    useEffect(() => {
        draftRef.current = onDraft;
        partsRef.current = parts;
    }, [onDraft, parts]);

    const { post, transform, processing } = useHttp<
        { provider: string; messages: Turn[]; parts: ItemPart[] },
        {
            say: string;
            parts: ItemPart[] | null;
            name: string | null;
            category: string | null;
            refused: string | null;
        }
    >({ provider: '', messages: [], parts: [] });

    // Follow the output down, the way a terminal does.
    useEffect(() => {
        const pane = scrollback.current;

        if (pane) {
            pane.scrollTop = pane.scrollHeight;
        }
    }, [lines, processing, stage]);

    function print(...printed: Line[]) {
        setLines((current) => [...current, ...printed]);
    }

    /* -------------------------------------------------------- the bridge */

    /**
     * One exchange with the shared board. Plain fetch, like the editor's
     * document autosave — this is a heartbeat, not a page visit.
     */
    async function talkToBoard(body: Record<string, unknown>) {
        const response = await fetch(boardRoute.url(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-XSRF-TOKEN': decodeURIComponent(
                    document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? '',
                ),
            },
            body: JSON.stringify(body),
        });

        return response.ok ? await response.json() : null;
    }

    // Ask the board what Claude Code has been up to.
    useEffect(() => {
        if (stage !== 'bridge') {
            return;
        }

        let alive = true;

        const tick = () => {
            void talkToBoard({}).then((body) => {
                if (!alive || !body) {
                    return;
                }

                if (body.claimed_at && !claimed.current) {
                    claimed.current = true;
                    setBridged(true);
                    print(
                        line(
                            'good',
                            '✓ Claude Code is at the board — nothing here bills an API account',
                        ),
                    );
                }

                if (
                    body.revision > lastRevision.current &&
                    body.source === 'claude'
                ) {
                    lastRevision.current = body.revision;

                    if (body.note) {
                        print(line('ai', body.note));
                    }

                    if (Array.isArray(body.parts) && body.parts.length > 0) {
                        adopting.current = true;
                        published.current = JSON.stringify(body.parts);
                        draftRef.current(body.parts, body.name, body.category);
                        print(
                            line(
                                'note',
                                `✱ board replaced — ${body.parts.length} part${body.parts.length === 1 ? '' : 's'}${body.name ? ` (${body.name})` : ''}`,
                            ),
                        );
                    }
                } else if (body.revision > lastRevision.current) {
                    lastRevision.current = body.revision;
                }
            });
        };

        tick();

        const timer = setInterval(tick, POLL_MS);

        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [stage]);

    // Hand edits go up so Claude Code revises what is really on screen.
    useEffect(() => {
        if (stage !== 'bridge') {
            return;
        }

        const serialised = JSON.stringify(parts);

        if (serialised === published.current) {
            return;
        }

        published.current = serialised;

        // The change we just adopted from Claude Code is not news to it.
        if (adopting.current) {
            adopting.current = false;

            return;
        }

        void talkToBoard({ publish: true, parts }).then((body) => {
            if (body) {
                lastRevision.current = body.revision;
            }
        });
    }, [stage, parts]);

    function startBridge() {
        setLines([]);
        setTranscript([]);
        setRunning('claude-code');
        setBridged(false);
        claimed.current = false;
        adopting.current = false;
        published.current = JSON.stringify(parts);
        setStage('bridge');

        void talkToBoard({ publish: true, parts }).then((body) => {
            if (body) {
                lastRevision.current = body.revision;
            }
        });
    }

    /* -------------------------------------------------------- the shell */

    /** Claude Code answering in the page, on the person's own plan. */
    function startClaude() {
        setLines([]);
        setClaudeSession(null);
        setRunning('claude-code');
        setStage('claude');
    }

    /**
     * One turn with the CLI. Plain fetch, because a turn can take a while
     * and this is a conversation, not a page visit.
     */
    async function claudeTurn(typed: string) {
        print(line('you', typed));
        setThinking(true);

        try {
            const response = await fetch(claudeRoute.url(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-XSRF-TOKEN': decodeURIComponent(
                        document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? '',
                    ),
                },
                body: JSON.stringify({
                    prompt: typed,
                    session: claudeSession,
                    parts,
                }),
            });

            const body = await response.json();

            if (!response.ok) {
                print(
                    line(
                        'error',
                        body?.message ?? 'Claude Code could not be reached',
                    ),
                );

                return;
            }

            if (body.session) {
                setClaudeSession(body.session);
            }

            print(line('ai', body.say));

            if (body.refused) {
                print(line('error', body.refused));
            }

            if (body.parts) {
                onDraft(body.parts, body.name, body.category);
                print(
                    line(
                        'note',
                        `✱ board replaced — ${body.parts.length} part${body.parts.length === 1 ? '' : 's'}${body.name ? ` (${body.name})` : ''}`,
                    ),
                );
            }
        } catch {
            print(line('error', 'no connection to the server'));
        } finally {
            setThinking(false);
        }
    }

    function shell(typed: string) {
        const words = typed.split(/\s+/);
        const command = words[0].toLowerCase();
        const wantsApi = words.includes('--api');

        if (command === 'claude' && !wantsApi) {
            if (claudeCodeReady) {
                startClaude();
            } else {
                print(
                    line(
                        'warn',
                        '⚠ Claude Code is not answering on this machine',
                    ),
                    line(
                        'note',
                        [
                            'Install it and sign in — then `claude` talks to you right here,',
                            'on your subscription, with no API charges:',
                            '',
                            '  npm install -g @anthropic-ai/claude-code',
                            '  claude          (sign in once)',
                            '',
                            'Already installed? It may not be on this server’s PATH — set',
                            'CLAUDE_CODE_BINARY to its full path. Or use `bridge`, or',
                            '`claude --api` with a key.',
                        ].join('\n'),
                    ),
                );
            }

            return;
        }

        if (command === 'bridge') {
            startBridge();

            return;
        }

        const binary = PROVIDERS.find(
            (provider) => provider.command === command,
        );

        if (binary) {
            const connection = connections.find(
                (candidate) => candidate.provider === binary.value,
            );

            if (!connection) {
                print(
                    line(
                        'warn',
                        `⚠ no ${binary.label} API key connected — add one below, then run it again`,
                    ),
                    ...(binary.value === 'anthropic'
                        ? [
                              line(
                                  'note',
                                  'or just run `claude` with no flag to use Claude Code on your plan, free',
                              ),
                          ]
                        : []),
                );
                setConnecting(true);

                return;
            }

            setLines([]);
            setTranscript([]);
            setRunning(binary.value);
            setStage('session');

            return;
        }

        switch (command) {
            case 'help':
                print(line('note', SHELL_HELP));
                break;
            case 'clear':
                setLines([]);
                break;
            case 'connect':
                setConnecting(true);
                break;
            case '':
                break;
            default:
                print(
                    line(
                        'error',
                        `${command}: command not found — try claude, or help`,
                    ),
                );
        }
    }

    /* ------------------------------------------------------ the session */

    function local(typed: string): boolean {
        if (typed !== '?' && !typed.startsWith('/')) {
            return false;
        }

        const [name] = typed.replace(/^\//, '').split(/\s+/, 1);

        switch (name === '?' ? 'help' : name) {
            case 'help':
                print(
                    line('you', typed),
                    line(
                        'note',
                        stage === 'bridge' ? BRIDGE_HELP : SESSION_HELP,
                    ),
                );
                break;
            case 'clear':
                setLines([]);
                setTranscript([]);
                break;
            case 'parts':
                print(line('you', typed), line('note', describeParts(parts)));
                break;
            case 'connect':
                print(line('you', typed));
                setConnecting(true);
                break;
            case 'exit':
                setStage('shell');
                setRunning(null);
                setBridged(false);
                setClaudeSession(null);
                setLines([
                    line(
                        'note',
                        stage === 'bridge' ? 'bridge closed' : 'session ended',
                    ),
                ]);
                setTranscript([]);
                break;
            default:
                print(
                    line('you', typed),
                    line('error', `unknown command /${name} — /help`),
                );
        }

        return true;
    }

    function session(typed: string) {
        if (local(typed) || !active) {
            return;
        }

        const messages: Turn[] = [
            ...transcript,
            { role: 'user', content: typed },
        ];

        print(line('you', typed));
        setTranscript(messages);

        transform(() => ({ provider: active.provider, messages, parts }));

        post(terminalRoute.url(), {
            onSuccess: (response) => {
                print(line('ai', response.say));

                let remembered = response.say;

                if (response.refused) {
                    print(line('error', response.refused));
                }

                if (response.parts) {
                    onDraft(response.parts, response.name, response.category);
                    print(
                        line(
                            'note',
                            `✱ board replaced — ${response.parts.length} part${response.parts.length === 1 ? '' : 's'}${response.name ? ` (${response.name})` : ''}`,
                        ),
                    );
                    remembered += `\n[the board now holds ${response.parts.length} parts]`;
                }

                setTranscript((current) => [
                    ...current,
                    { role: 'assistant', content: remembered },
                ]);
            },
            onHttpException: (response) => {
                const body = response.data as { message?: string } | null;

                print(
                    line(
                        'error',
                        body?.message ?? 'the AI could not be reached',
                    ),
                );

                return false;
            },
            onNetworkError: () => {
                print(line('error', 'no connection to the server'));

                return false;
            },
        }).catch(() => {
            // Already printed through the callbacks above.
        });
    }

    function bridge(typed: string) {
        if (local(typed)) {
            return;
        }

        print(
            line('you', typed),
            line('note', '· left for Claude Code to read when it next looks'),
        );

        void talkToBoard({ message: typed });
    }

    function run(raw: string) {
        const typed = raw.trim();

        if (processing || thinking) {
            return;
        }

        setInput('');

        if (stage === 'shell') {
            if (typed !== '') {
                print(line('you', typed));
            }

            shell(typed);

            return;
        }

        if (typed === '') {
            return;
        }

        if (stage === 'bridge') {
            bridge(typed);
        } else if (stage === 'claude') {
            if (!local(typed)) {
                void claudeTurn(typed);
            }
        } else {
            session(typed);
        }
    }

    return (
        <section
            className="overflow-hidden rounded-lg border border-chrome-border bg-chrome text-chrome-fg"
            onClick={() => {
                if (!connecting) {
                    promptInput.current?.focus();
                }
            }}
        >
            <div
                ref={scrollback}
                className="h-72 scrollbar-chrome overflow-y-auto px-4 py-3 font-mono text-[0.78rem] leading-relaxed"
            >
                {stage === 'claude' ? (
                    <ClaudeBanner />
                ) : stage === 'bridge' ? (
                    <BridgeBanner bridged={bridged} />
                ) : stage === 'session' && active ? (
                    <SessionBanner connection={active} />
                ) : (
                    lines.length === 0 && (
                        <p className="text-chrome-muted">
                            axon shell — type{' '}
                            <span className="text-ember">claude</span> to talk
                            to Claude here, on your own plan. help for more.
                        </p>
                    )
                )}

                <div className="mt-1 space-y-1.5">
                    {lines.map((printed) => (
                        <p
                            key={printed.id}
                            className={cn(
                                'break-words whitespace-pre-wrap',
                                printed.kind === 'you' &&
                                    'text-chrome-fg before:mr-2 before:text-ember before:content-["❯"]',
                                printed.kind === 'ai' && 'text-chrome-fg/90',
                                printed.kind === 'note' && 'text-chrome-muted',
                                printed.kind === 'warn' && 'text-[#e5b567]',
                                printed.kind === 'good' && 'text-[#7fb069]',
                                printed.kind === 'error' && 'text-destructive',
                            )}
                        >
                            {printed.text}
                        </p>
                    ))}

                    {(processing || thinking) && (
                        <p className="animate-pulse text-chrome-muted">
                            ✱ thinking…
                        </p>
                    )}

                    {stage === 'bridge' && !bridged && (
                        <p className="animate-pulse text-chrome-muted">
                            ⠋ waiting for Claude Code…
                        </p>
                    )}
                </div>
            </div>

            {connecting && (
                <div className="border-t border-chrome-border p-4">
                    <ConnectAccounts
                        connections={connections}
                        onConnected={() => setConnecting(false)}
                        onDone={() => setConnecting(false)}
                    />
                </div>
            )}

            {/* ------------------------------------------- the prompt line */}
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    run(input);
                }}
                className="border-t border-chrome-border px-4 py-2.5"
            >
                <div className="flex items-center gap-2">
                    <span
                        className={cn(
                            'font-mono text-sm',
                            stage === 'shell'
                                ? 'text-chrome-muted'
                                : 'text-ember',
                        )}
                    >
                        {stage === 'shell' ? '❯' : '>'}
                    </span>
                    <input
                        ref={promptInput}
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        placeholder={
                            stage === 'shell'
                                ? 'claude'
                                : stage === 'bridge'
                                  ? 'type in Claude Code — or leave a note here · /exit'
                                  : parts.length === 0
                                    ? 'Try "a walnut reading chair, 900 wide"'
                                    : 'Try "make the arms thinner" · /exit to leave'
                        }
                        disabled={thinking}
                        spellCheck={false}
                        autoComplete="off"
                        className="flex-1 bg-transparent font-mono text-[0.82rem] text-chrome-fg caret-teal-400 outline-none placeholder:text-chrome-muted/50"
                    />
                </div>
            </form>

            {stage !== 'shell' && (
                <div className="flex items-center justify-between border-t border-chrome-border/60 px-4 py-1.5 font-mono text-[0.65rem] text-chrome-muted">
                    <span>? for shortcuts · /exit to leave</span>
                    <span>
                        <span
                            className={
                                stage === 'bridge' && !bridged
                                    ? 'text-[#e5b567]'
                                    : 'text-ember'
                            }
                        >
                            ●
                        </span>{' '}
                        {stage === 'claude'
                            ? 'claude code · your plan'
                            : stage === 'bridge'
                              ? bridged
                                  ? 'claude code · your plan'
                                  : 'waiting'
                              : active?.model}{' '}
                        · {parts.length} part{parts.length === 1 ? '' : 's'} on
                        the board
                    </span>
                </div>
            )}
        </section>
    );
}

/* ------------------------------------------------------------- banners */

/**
 * The boot banner for Claude answering in the page through the local CLI.
 */
function ClaudeBanner() {
    return (
        <div className="flex items-start gap-4 pb-2">
            <Mascot />
            <div className="leading-relaxed">
                <p>
                    <span className="font-bold">Claude Code</span>{' '}
                    <span className="text-chrome-muted">· your plan</span>
                </p>
                <p className="text-chrome-muted">
                    at the item designer board · no API charges
                </p>
                <p className="text-chrome-muted">
                    describe an object, or tell me what to change
                </p>
            </div>
        </div>
    );
}

/**
 * The bridge banner: what to run, and where. Deliberately explicit — the
 * whole point is that the work happens in the user's own Claude Code.
 */
function BridgeBanner({ bridged }: { bridged: boolean }) {
    return (
        <div className="space-y-2 pb-1">
            <div className="flex items-start gap-4">
                <Mascot />
                <div className="leading-relaxed">
                    <p>
                        <span className="font-bold">Claude Code</span>{' '}
                        <span className="text-chrome-muted">
                            · your subscription
                        </span>
                    </p>
                    <p className="text-chrome-muted">
                        working this board over MCP · no API charges
                    </p>
                </div>
            </div>

            {!bridged && (
                <div className="text-chrome-muted">
                    <p className="text-[#e5b567]">
                        ⚠ In a terminal on this computer:
                    </p>
                    <p className="mt-1 pl-3 text-chrome-fg">
                        cd ~\Herd\vanhaven-design-software
                    </p>
                    <p className="pl-3 text-chrome-fg">claude</p>
                    <p className="mt-1 pl-3">
                        then say:{' '}
                        <span className="text-chrome-fg">
                            “work the Axon design board”
                        </span>
                    </p>
                </div>
            )}
        </div>
    );
}

/**
 * The boot banner for a keyed, in-page session.
 */
function SessionBanner({ connection }: { connection: AiConnectionSummary }) {
    return (
        <div className="flex items-start gap-4 pb-2">
            <Mascot />
            <div className="leading-relaxed">
                <p>
                    <span className="font-bold">{connection.label}</span>{' '}
                    <span className="text-chrome-muted">
                        for Axon · API key
                    </span>
                </p>
                <p className="text-chrome-muted">
                    {connection.model} · billed per token
                </p>
                <p className="text-chrome-muted">~ the item designer board</p>
            </div>
        </div>
    );
}

/**
 * A friendly pixel creature in Axon's ember, in the family of the one that
 * lives in the real terminal.
 */
function Mascot() {
    return (
        <svg
            viewBox="0 0 110 78"
            className="mt-1 h-11 w-auto shrink-0"
            shapeRendering="crispEdges"
            aria-hidden
        >
            <g className="fill-ember">
                <rect x="8" y="0" width="22" height="12" />
                <rect x="80" y="0" width="22" height="12" />
                <rect x="0" y="12" width="110" height="42" />
                <rect x="12" y="54" width="14" height="14" />
                <rect x="48" y="54" width="14" height="14" />
                <rect x="84" y="54" width="14" height="14" />
            </g>
            <g className="fill-chrome">
                <rect x="22" y="24" width="16" height="18" />
                <rect x="72" y="24" width="16" height="18" />
            </g>
        </svg>
    );
}

/* -------------------------------------------------------- the connections */

/**
 * Connect or rekey API accounts. Keys go straight to the server, are stored
 * encrypted, and are never sent back to the browser. Nothing here is needed
 * for the Claude Code bridge.
 */
function ConnectAccounts({
    connections,
    onConnected,
    onDone,
}: {
    connections: AiConnectionSummary[];
    onConnected: () => void;
    onDone: () => void;
}) {
    const [provider, setProvider] = useState<string>(
        PROVIDERS.find(
            (candidate) =>
                !connections.some(
                    (connection) => connection.provider === candidate.value,
                ),
        )?.value ?? 'anthropic',
    );

    const chosen =
        PROVIDERS.find((candidate) => candidate.value === provider) ??
        PROVIDERS[0];

    return (
        <div className="space-y-3">
            <p className="font-mono text-[0.68rem] text-chrome-muted">
                API keys are for the in-page sessions. To use your Claude
                subscription instead, close this and run{' '}
                <span className="text-ember">claude</span>.
            </p>

            {connections.length > 0 && (
                <ul className="space-y-1.5">
                    {connections.map((connection) => (
                        <li
                            key={connection.id}
                            className="flex items-center justify-between rounded-md border border-chrome-border px-3 py-1.5 font-mono text-xs"
                        >
                            <span>
                                <span className="text-chrome-fg">
                                    {connection.label}
                                </span>{' '}
                                <span className="text-chrome-muted">
                                    · {connection.model} · key on file
                                </span>
                            </span>
                            <button
                                type="button"
                                title={`Disconnect ${connection.label}`}
                                onClick={() =>
                                    router.delete(disconnect(connection.id), {
                                        preserveScroll: true,
                                        preserveState: true,
                                    })
                                }
                                className="flex items-center gap-1 text-chrome-muted transition-colors hover:text-destructive"
                            >
                                <Unplug className="size-3.5" />
                                disconnect
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <Form
                action={connect()}
                method="post"
                options={{ preserveScroll: true, preserveState: true }}
                onSuccess={onConnected}
                resetOnSuccess
                className="space-y-3"
            >
                {({ errors, processing }) => (
                    <>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {PROVIDERS.map((candidate) => (
                                <button
                                    key={candidate.value}
                                    type="button"
                                    onClick={() => setProvider(candidate.value)}
                                    className={cn(
                                        'rounded-full border px-3 py-1 font-mono text-xs transition-colors',
                                        provider === candidate.value
                                            ? 'border-ember text-ember'
                                            : 'border-chrome-border text-chrome-muted hover:border-ember/60',
                                    )}
                                >
                                    {candidate.label}
                                </button>
                            ))}
                            <input
                                type="hidden"
                                name="provider"
                                value={provider}
                            />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="grid gap-1">
                                <Label className="font-mono text-[0.62rem] tracking-wide text-chrome-muted uppercase">
                                    API key
                                </Label>
                                <Input
                                    name="key"
                                    type="password"
                                    placeholder={chosen.keyHint}
                                    autoComplete="off"
                                    required
                                    className="border-chrome-border bg-chrome-sunken font-mono text-chrome-fg"
                                />
                                {errors.key && (
                                    <p className="text-xs text-destructive">
                                        {errors.key}
                                    </p>
                                )}
                            </div>
                            <div className="grid gap-1">
                                <Label className="font-mono text-[0.62rem] tracking-wide text-chrome-muted uppercase">
                                    Model (optional)
                                </Label>
                                <Input
                                    name="model"
                                    placeholder={chosen.modelHint}
                                    className="border-chrome-border bg-chrome-sunken font-mono text-chrome-fg"
                                />
                                {errors.model && (
                                    <p className="text-xs text-destructive">
                                        {errors.model}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <p className="font-mono text-[0.68rem] text-chrome-muted">
                                stored encrypted, never shown again
                            </p>
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={onDone}
                                    className="text-chrome-muted hover:text-chrome-fg"
                                >
                                    close
                                </Button>
                                <Button
                                    type="submit"
                                    size="sm"
                                    disabled={processing}
                                >
                                    <Plug className="size-4" />
                                    {processing ? 'connecting…' : 'connect'}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </Form>
        </div>
    );
}
