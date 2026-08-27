import { Form, Head, Link, router, usePoll } from '@inertiajs/react';
import {
    Building2,
    CalendarClock,
    Check,
    ChevronDown,
    Crown,
    Send,
    UsersRound,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { chat } from '@/routes';
import { status as updateStatus } from '@/routes/chat';
import { show as organization } from '@/routes/organization';
import { store as postMessage } from '@/routes/organization/messages';

/** Everything the page knows about a presence state, Teams-fashion. */
const PRESENCE: Record<
    string,
    {
        label: string;
        dot: string;
        text: string;
        hollow?: boolean;
        dash?: boolean;
    }
> = {
    available: {
        label: 'Available',
        dot: 'bg-emerald-500',
        text: 'text-emerald-600',
    },
    busy: { label: 'Busy', dot: 'bg-red-600', text: 'text-red-600' },
    meeting: {
        label: 'In a meeting',
        dot: 'bg-red-600',
        text: 'text-red-600',
    },
    dnd: {
        label: 'Do not disturb',
        dot: 'bg-red-600',
        text: 'text-red-600',
        dash: true,
    },
    brb: {
        label: 'Be right back',
        dot: 'bg-amber-400',
        text: 'text-amber-600',
    },
    away: { label: 'Away', dot: 'bg-amber-400', text: 'text-amber-600' },
    offline: {
        label: 'Offline',
        dot: 'border-2 border-muted-foreground/60 bg-background',
        text: 'text-muted-foreground',
        hollow: true,
    },
};

/** The statuses a member can pin on themselves, in menu order. */
const MANUAL_CHOICES = [
    'available',
    'busy',
    'dnd',
    'brb',
    'away',
    'offline',
] as const;

type Presence = {
    status: string;
    message: string | null;
    meeting: string | null;
};

type Member = {
    id: number;
    name: string;
    email: string;
    is_head: boolean;
    is_me: boolean;
    presence: Presence;
    last_active_at: string | null;
    /** Direct messages from this member still waiting to be read. */
    unread: number;
};

type ChatMessage = {
    id: number;
    body: string;
    author: string;
    author_id: number | null;
    mine: boolean;
    created_at: string | null;
};

type ChatPageProps = {
    organization: { name: string } | null;
    members: Member[];
    conversation: ChatMessage[];
    /** The colleague whose private thread is open, or null for the channel. */
    with: number | null;
    me: { presence: string | null; message: string | null };
};

export default function ChatPage({
    organization,
    members,
    conversation,
    with: withId,
    me,
}: ChatPageProps) {
    if (!organization) {
        return (
            <>
                <Head title="Chat" />
                <NoOrganization />
            </>
        );
    }

    const partner = members.find((member) => member.id === withId) ?? null;

    return (
        <>
            <Head
                title={
                    partner
                        ? `Chat — ${partner.name}`
                        : `Chat — ${organization.name}`
                }
            />
            <ChatRoom
                name={organization.name}
                members={members}
                conversation={conversation}
                partner={partner}
                me={me}
            />
        </>
    );
}

/* ---------------------------------------------------------------- the room */

/**
 * Only ever mounted once there is an organization to poll for. Inertia's
 * usePoll reads its interval once, on mount, and has no guard against zero —
 * a falsy interval means setInterval(…, 0), which floods the server.
 */
function ChatRoom({
    name,
    members,
    conversation,
    partner,
    me,
}: {
    name: string;
    members: Member[];
    conversation: ChatMessage[];
    partner: Member | null;
    me: { presence: string | null; message: string | null };
}) {
    // Presence and the conversation stay current without anyone refreshing.
    usePoll(5000, { only: ['conversation', 'members'] });

    const present = members.filter(
        (member) => member.presence.status !== 'offline',
    ).length;

    return (
        <div className="flex h-full flex-1 flex-col gap-6 p-6">
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
                <div>
                    <p className="ax-eyebrow text-muted-foreground">{name}</p>
                    <h1 className="mt-2 text-2xl font-light tracking-tight">
                        Chat
                    </h1>
                    <div className="ax-rule mt-3" />
                    <p className="mt-3 text-sm text-muted-foreground">
                        {present} of {members.length}{' '}
                        {members.length === 1 ? 'person' : 'people'} here now.
                    </p>
                </div>

                <MyStatus me={me} />
            </header>

            <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(260px,320px)_1fr]">
                <PeopleRail members={members} partner={partner} />
                <Conversation
                    name={name}
                    members={members}
                    conversation={conversation}
                    partner={partner}
                />
            </div>
        </div>
    );
}

/* ---------------------------------------------------------------- presence */

/**
 * The coloured dot Teams puts on everyone: solid green for available, red
 * for busy and meetings, a dashed red for do not disturb, amber for away,
 * and a hollow ring for whoever is gone.
 */
function PresenceDot({
    status,
    className,
}: {
    status: string;
    className?: string;
}) {
    const shown = PRESENCE[status] ?? PRESENCE.offline;

    return (
        <span
            title={shown.label}
            className={cn(
                'flex size-3 items-center justify-center rounded-full',
                shown.dot,
                className,
            )}
        >
            {shown.dash && (
                <span className="block h-0.5 w-1.5 rounded-full bg-white" />
            )}
        </span>
    );
}

/** Avatar initials with the presence dot pinned to its corner. */
function MemberAvatar({
    name,
    status,
    size = 'md',
}: {
    name: string;
    status: string;
    size?: 'sm' | 'md';
}) {
    const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('');

    return (
        <span className="relative inline-block shrink-0">
            <span
                className={cn(
                    'flex items-center justify-center rounded-full bg-sand/25 font-medium text-ink dark:text-sand',
                    size === 'md' ? 'size-9 text-xs' : 'size-7 text-[0.6rem]',
                )}
            >
                {initials}
            </span>
            <PresenceDot
                status={status}
                className="absolute -right-0.5 -bottom-0.5 ring-2 ring-card"
            />
        </span>
    );
}

/**
 * What a member's status line reads: the meeting they are sitting in beats
 * the label, and their own message rides along after it.
 */
function statusLine(presence: Presence): string {
    const label =
        presence.status === 'meeting' && presence.meeting
            ? `In a meeting — ${presence.meeting}`
            : (PRESENCE[presence.status] ?? PRESENCE.offline).label;

    return presence.message ? `${label} · ${presence.message}` : label;
}

/* ------------------------------------------------------------- the people */

function PeopleRail({
    members,
    partner,
}: {
    members: Member[];
    partner: Member | null;
}) {
    // The present come first, meetings and all, the way a studio reads.
    const ordered = [...members].sort((a, b) => {
        const gone = (member: Member) =>
            member.presence.status === 'offline' ? 1 : 0;

        return gone(a) - gone(b) || a.name.localeCompare(b.name);
    });

    return (
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
            <p className="ax-eyebrow border-b border-border px-5 py-3 text-[0.6rem] text-muted-foreground">
                Conversations
            </p>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <Link
                    href={chat()}
                    preserveScroll
                    className={cn(
                        'flex w-full items-center gap-3 border-b border-border px-5 py-3 text-left transition-colors hover:bg-muted/60',
                        partner === null && 'bg-accent/60',
                    )}
                >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sand/25">
                        <UsersRound className="size-4 text-ink dark:text-sand" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                            Team
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                            Everyone in the studio
                        </span>
                    </span>
                </Link>

                <ul className="divide-y divide-border">
                    {ordered.map((member) => {
                        const row = (
                            <>
                                <MemberAvatar
                                    name={member.name}
                                    status={member.presence.status}
                                />

                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                                        {member.name}
                                        {member.is_me && (
                                            <span className="text-xs font-normal text-muted-foreground">
                                                (you)
                                            </span>
                                        )}
                                        {member.is_head && (
                                            <Crown className="size-3 shrink-0 text-sand" />
                                        )}
                                    </span>
                                    <span
                                        className={cn(
                                            'flex items-center gap-1 truncate text-xs',
                                            (
                                                PRESENCE[
                                                    member.presence.status
                                                ] ?? PRESENCE.offline
                                            ).text,
                                        )}
                                    >
                                        {member.presence.status ===
                                            'meeting' && (
                                            <CalendarClock className="size-3 shrink-0" />
                                        )}
                                        <span className="truncate">
                                            {member.presence.status ===
                                            'offline'
                                                ? lastSeen(
                                                      member.last_active_at,
                                                  )
                                                : statusLine(member.presence)}
                                        </span>
                                    </span>
                                </span>

                                {member.unread > 0 && (
                                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ember text-[0.62rem] font-semibold text-white">
                                        {member.unread > 9
                                            ? '9+'
                                            : member.unread}
                                    </span>
                                )}
                            </>
                        );

                        return (
                            <li key={member.id}>
                                {member.is_me ? (
                                    <span
                                        className={cn(
                                            'flex items-center gap-3 px-5 py-3',
                                            member.presence.status ===
                                                'offline' && 'opacity-60',
                                        )}
                                    >
                                        {row}
                                    </span>
                                ) : (
                                    <Link
                                        href={chat({
                                            query: { with: member.id },
                                        })}
                                        preserveScroll
                                        className={cn(
                                            'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/60',
                                            partner?.id === member.id &&
                                                'bg-accent/60',
                                            member.presence.status ===
                                                'offline' && 'opacity-60',
                                        )}
                                    >
                                        {row}
                                    </Link>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </div>
        </section>
    );
}

function lastSeen(iso: string | null): string {
    if (!iso) {
        return 'Offline';
    }

    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);

    if (minutes < 60) {
        return `Last seen ${Math.max(minutes, 1)}m ago`;
    }

    if (minutes < 60 * 24) {
        return `Last seen ${Math.round(minutes / 60)}h ago`;
    }

    return `Last seen ${new Date(iso).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
    })}`;
}

/* ------------------------------------------------------------ my own status */

function MyStatus({
    me,
}: {
    me: { presence: string | null; message: string | null };
}) {
    const current = me.presence ?? 'auto';
    const shown =
        current === 'auto'
            ? { label: 'Automatic', status: 'available' }
            : {
                  label: (PRESENCE[current] ?? PRESENCE.offline).label,
                  status: current,
              };

    const choose = (presence: string) => {
        router.put(
            updateStatus(),
            { presence, message: me.message ?? '' },
            { preserveScroll: true, only: ['members', 'me'] },
        );
    };

    return (
        <div className="flex flex-col items-end gap-2">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                        <PresenceDot status={shown.status} />
                        {shown.label}
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                    <StatusChoice
                        label="Automatic"
                        detail="Meetings turn you red by themselves"
                        status="available"
                        selected={current === 'auto'}
                        onSelect={() => choose('auto')}
                    />
                    <DropdownMenuSeparator />
                    {MANUAL_CHOICES.map((choice) => (
                        <StatusChoice
                            key={choice}
                            label={
                                choice === 'offline'
                                    ? 'Appear offline'
                                    : PRESENCE[choice].label
                            }
                            status={choice}
                            selected={current === choice}
                            onSelect={() => choose(choice)}
                        />
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <StatusMessage me={me} />
        </div>
    );
}

function StatusChoice({
    label,
    detail,
    status,
    selected,
    onSelect,
}: {
    label: string;
    detail?: string;
    status: string;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <DropdownMenuItem onSelect={onSelect} className="gap-2">
            <PresenceDot status={status} />
            <span className="flex-1">
                {label}
                {detail && (
                    <span className="block text-[0.65rem] text-muted-foreground">
                        {detail}
                    </span>
                )}
            </span>
            {selected && <Check className="size-3.5" />}
        </DropdownMenuItem>
    );
}

/** The little "what I'm up to" line that follows the name around. */
function StatusMessage({
    me,
}: {
    me: { presence: string | null; message: string | null };
}) {
    return (
        <input
            key={me.message ?? ''}
            defaultValue={me.message ?? ''}
            placeholder="Set a status message…"
            maxLength={120}
            onKeyDown={(event) => {
                if (event.key === 'Enter') {
                    event.currentTarget.blur();
                }
            }}
            onBlur={(event) => {
                const message = event.target.value.trim();

                if (message === (me.message ?? '')) {
                    return;
                }

                router.put(
                    updateStatus(),
                    { presence: me.presence ?? 'auto', message },
                    { preserveScroll: true, only: ['members', 'me'] },
                );
            }}
            className="w-56 rounded-md border border-input bg-transparent px-2.5 py-1 text-right text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />
    );
}

/* ------------------------------------------------------------ conversation */

function Conversation({
    name,
    members,
    conversation,
    partner,
}: {
    name: string;
    members: Member[];
    conversation: ChatMessage[];
    partner: Member | null;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const latestId = conversation.at(-1)?.id ?? 0;
    const thread = partner?.id ?? 'team';
    const presenceOf = new Map(
        members.map((member) => [member.id, member.presence.status]),
    );

    // Follow the conversation as it arrives, and jump on switching threads.
    useEffect(() => {
        const container = scrollRef.current;

        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [latestId, thread]);

    return (
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                {partner ? (
                    <div className="flex min-w-0 items-center gap-2.5">
                        <MemberAvatar
                            name={partner.name}
                            status={partner.presence.status}
                            size="sm"
                        />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {partner.name}
                            </p>
                            <p
                                className={cn(
                                    'truncate text-[0.65rem]',
                                    (
                                        PRESENCE[partner.presence.status] ??
                                        PRESENCE.offline
                                    ).text,
                                )}
                            >
                                {statusLine(partner.presence)}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                        Team conversation
                    </p>
                )}
                <p className="shrink-0 text-[0.65rem] text-muted-foreground">
                    {name}
                </p>
            </div>

            <div
                ref={scrollRef}
                className="min-h-64 flex-1 space-y-3 overflow-y-auto px-5 py-4"
            >
                {conversation.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                        {partner
                            ? `Nothing said yet — just between you and ${partner.name}.`
                            : 'Nothing said yet. Start the conversation.'}
                    </p>
                ) : (
                    conversation.map((message, index) => {
                        const previous = conversation[index - 1];

                        return (
                            <div key={message.id}>
                                {startsNewDay(previous, message) && (
                                    <DaySeparator iso={message.created_at} />
                                )}
                                <Bubble
                                    message={message}
                                    presence={
                                        message.author_id !== null
                                            ? (presenceOf.get(
                                                  message.author_id,
                                              ) ?? 'offline')
                                            : 'offline'
                                    }
                                    showAuthor={
                                        !previous ||
                                        previous.author !== message.author ||
                                        startsNewDay(previous, message)
                                    }
                                />
                            </div>
                        );
                    })
                )}
            </div>

            <Form
                key={thread}
                action={postMessage()}
                method="post"
                options={{ preserveScroll: true, only: ['conversation'] }}
                resetOnSuccess
                className="flex items-end gap-2 border-t border-border p-3"
            >
                {({ processing }) => (
                    <>
                        {partner && (
                            <input
                                type="hidden"
                                name="recipient_id"
                                value={partner.id}
                            />
                        )}
                        <textarea
                            name="body"
                            rows={1}
                            required
                            placeholder={
                                partner
                                    ? `Message ${partner.name}…`
                                    : 'Message the team…'
                            }
                            onKeyDown={(event) => {
                                // Enter sends, Shift+Enter starts a new line.
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    event.currentTarget.form?.requestSubmit();
                                }
                            }}
                            className="max-h-32 min-h-9 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring"
                        />
                        <Button type="submit" size="sm" disabled={processing}>
                            <Send className="size-4" />
                            Send
                        </Button>
                    </>
                )}
            </Form>
        </section>
    );
}

function startsNewDay(
    previous: ChatMessage | undefined,
    message: ChatMessage,
): boolean {
    if (!message.created_at) {
        return false;
    }

    if (!previous?.created_at) {
        return true;
    }

    return (
        new Date(previous.created_at).toDateString() !==
        new Date(message.created_at).toDateString()
    );
}

function DaySeparator({ iso }: { iso: string | null }) {
    if (!iso) {
        return null;
    }

    const date = new Date(iso);
    const label =
        date.toDateString() === new Date().toDateString()
            ? 'Today'
            : date.toLocaleDateString('en-CA', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
              });

    return (
        <div className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[0.62rem] tracking-wide text-muted-foreground uppercase">
                {label}
            </span>
            <span className="h-px flex-1 bg-border" />
        </div>
    );
}

function Bubble({
    message,
    presence,
    showAuthor,
}: {
    message: ChatMessage;
    presence: string;
    showAuthor: boolean;
}) {
    return (
        <div
            className={cn(
                'flex gap-2.5',
                message.mine ? 'justify-end' : 'justify-start',
            )}
        >
            {!message.mine && (
                <span className={cn('mt-0.5', !showAuthor && 'invisible')}>
                    <MemberAvatar
                        name={message.author}
                        status={presence}
                        size="sm"
                    />
                </span>
            )}

            <div
                className={cn(
                    'flex max-w-[75%] flex-col',
                    message.mine ? 'items-end' : 'items-start',
                )}
            >
                {showAuthor && !message.mine && (
                    <p className="mb-1 ml-1 text-[0.68rem] text-muted-foreground">
                        {message.author}
                    </p>
                )}

                <div
                    className={cn(
                        'rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                        message.mine
                            ? 'bg-ink text-paper dark:bg-sand dark:text-ink'
                            : 'bg-muted text-foreground',
                    )}
                >
                    {message.body}
                </div>

                <p className="mt-1 px-1 text-[0.62rem] text-muted-foreground">
                    {formatTime(message.created_at)}
                </p>
            </div>
        </div>
    );
}

function formatTime(iso: string | null): string {
    if (!iso) {
        return '';
    }

    return new Date(iso).toLocaleTimeString('en-CA', {
        hour: 'numeric',
        minute: '2-digit',
    });
}

/* --------------------------------------------------------- no organization */

function NoOrganization() {
    return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
            <Building2 className="size-8 text-sand" />
            <div>
                <h1 className="text-xl font-light tracking-tight">
                    Chat lives inside an organization
                </h1>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                    Start a studio or join one with a code, and this page
                    becomes the team's conversation with everyone's status
                    beside it.
                </p>
            </div>
            <Button asChild>
                <Link href={organization()}>Go to Organization</Link>
            </Button>
        </div>
    );
}

ChatPage.layout = {
    breadcrumbs: [
        {
            title: 'Chat',
            href: chat(),
        },
    ],
};
