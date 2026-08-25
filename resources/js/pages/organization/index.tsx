import { Form, Head, router, usePoll } from '@inertiajs/react';
import {
    Building2,
    Check,
    Copy,
    Crown,
    KeyRound,
    Link2,
    LogOut,
    Mail,
    Pencil,
    RefreshCw,
    RotateCcw,
    Send,
    Users,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { claim, decline } from '@/routes/invitations';
import {
    destroy,
    join,
    leave,
    show,
    store,
    update,
} from '@/routes/organization';
import { regenerate } from '@/routes/organization/code';
import {
    destroy as revokeInvitation,
    resend as resendInvitation,
    store as sendInvitation,
} from '@/routes/organization/invitations';
import { store as postMessage } from '@/routes/organization/messages';

type Member = {
    id: number;
    name: string;
    email: string;
    is_head: boolean;
    is_me: boolean;
};

type ChatMessage = {
    id: number;
    body: string;
    author: string;
    mine: boolean;
    created_at: string | null;
};

type OrganizationData = {
    id: number;
    name: string;
    is_head: boolean;
    join_code: string | null;
    members: Member[];
};

/** An invitation the head has sent out and is still waiting on. */
type SentInvitation = {
    id: number;
    email: string;
    url: string;
    inviter: string | null;
    expires_at: string;
};

/** An invitation waiting for the person reading the page. */
type ReceivedInvitation = {
    id: number;
    organization: string;
    inviter: string | null;
    expires_at: string;
};

type OrganizationPageProps = {
    organization: OrganizationData | null;
    messages: ChatMessage[];
    invitations: SentInvitation[];
    receivedInvitations: ReceivedInvitation[];
};

export default function OrganizationPage({
    organization,
    messages,
    invitations,
    receivedInvitations,
}: OrganizationPageProps) {
    if (!organization) {
        return (
            <>
                <Head title="Organization" />
                <Onboarding invitations={receivedInvitations} />
            </>
        );
    }

    return (
        <>
            <Head title={organization.name} />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <OrganizationHeader organization={organization} />

                <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[1fr_1.3fr]">
                    <div className="space-y-6">
                        {organization.is_head && (
                            <InviteCard invitations={invitations} />
                        )}
                        {organization.is_head && organization.join_code && (
                            <JoinCodeCard code={organization.join_code} />
                        )}
                        <MemberList organization={organization} />
                    </div>

                    <TeamChat messages={messages} name={organization.name} />
                </div>
            </div>
        </>
    );
}

/* --------------------------------------------------------- no organization */

function Onboarding({ invitations }: { invitations: ReceivedInvitation[] }) {
    return (
        <div className="flex h-full flex-1 flex-col gap-8 p-6">
            <header className="border-b border-border pb-6">
                <p className="ax-eyebrow text-muted-foreground">Axon</p>
                <h1 className="mt-2 text-2xl font-light tracking-tight">
                    Organization
                </h1>
                <div className="ax-rule mt-3" />
                <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                    Work as a studio. Everyone in an organization shares the
                    same projects, clients and hours, and can talk in one place.
                </p>
            </header>

            <InvitationInbox invitations={invitations} />

            <div className="grid gap-5 md:grid-cols-2">
                <section className="rounded-lg border border-border bg-card p-6">
                    <Building2 className="size-6 text-sand" />
                    <h2 className="mt-4 text-lg font-medium">
                        Start an organization
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Name it whatever you like. You become its head and get a
                        join code to hand to the people who work with you.
                    </p>

                    <Form
                        action={store()}
                        method="post"
                        options={{ preserveScroll: true }}
                        className="mt-5 space-y-3"
                    >
                        {({ errors, processing }) => (
                            <>
                                <Field
                                    label="Organization name"
                                    error={errors.name}
                                >
                                    <Input
                                        name="name"
                                        placeholder="Ridgeway Architects"
                                        required
                                    />
                                </Field>
                                <Button
                                    type="submit"
                                    disabled={processing}
                                    className="w-full"
                                >
                                    {processing
                                        ? 'Creating…'
                                        : 'Create organization'}
                                </Button>
                            </>
                        )}
                    </Form>
                </section>

                <section className="rounded-lg border border-border bg-card p-6">
                    <KeyRound className="size-6 text-sand" />
                    <h2 className="mt-4 text-lg font-medium">
                        Join with a code
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Enter the code your studio head gave you. You will see
                        the whole team's work straight away.
                    </p>

                    <Form
                        action={join()}
                        method="post"
                        options={{ preserveScroll: true }}
                        className="mt-5 space-y-3"
                    >
                        {({ errors, processing }) => (
                            <>
                                <Field label="Join code" error={errors.code}>
                                    <Input
                                        name="code"
                                        placeholder="AX-4KQ2-8ZTM"
                                        autoCapitalize="characters"
                                        className="font-mono tracking-wider"
                                        required
                                    />
                                </Field>
                                <Button
                                    type="submit"
                                    variant="outline"
                                    disabled={processing}
                                    className="w-full"
                                >
                                    {processing
                                        ? 'Joining…'
                                        : 'Join organization'}
                                </Button>
                            </>
                        )}
                    </Form>
                </section>
            </div>
        </div>
    );
}

/* ------------------------------------------------- invitations, receiving */

function InvitationInbox({
    invitations,
}: {
    invitations: ReceivedInvitation[];
}) {
    if (invitations.length === 0) {
        return null;
    }

    return (
        <section className="rounded-lg border border-sand/40 bg-accent/40 p-6">
            <div className="flex items-center gap-2">
                <Mail className="size-4 text-sand" />
                <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                    {invitations.length === 1
                        ? 'You have an invitation'
                        : `You have ${invitations.length} invitations`}
                </p>
            </div>

            <ul className="mt-2 divide-y divide-sand/30">
                {invitations.map((invitation) => (
                    <li
                        key={invitation.id}
                        className="flex flex-wrap items-center justify-between gap-4 py-3"
                    >
                        <div className="min-w-0">
                            <p className="truncate text-base font-medium">
                                {invitation.organization}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {invitation.inviter
                                    ? `${invitation.inviter} asked you to join`
                                    : 'You have been asked to join'}
                                {' · expires '}
                                {formatDate(invitation.expires_at)}
                            </p>
                        </div>

                        <div className="flex shrink-0 gap-2">
                            <Button
                                size="sm"
                                onClick={() =>
                                    router.post(
                                        claim(invitation.id),
                                        {},
                                        { preserveScroll: true },
                                    )
                                }
                            >
                                <Check className="size-3.5" />
                                Accept
                            </Button>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                    router.delete(decline(invitation.id), {
                                        preserveScroll: true,
                                    })
                                }
                            >
                                Decline
                            </Button>
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/* --------------------------------------------------- invitations, sending */

function InviteCard({ invitations }: { invitations: SentInvitation[] }) {
    return (
        <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <Mail className="size-4 text-sand" />
                <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                    Invite by email
                </p>
            </div>

            <div className="p-5">
                <Form
                    action={sendInvitation()}
                    method="post"
                    options={{ preserveScroll: true }}
                    resetOnSuccess
                    className="flex flex-col gap-3 sm:flex-row sm:items-end"
                >
                    {({ errors, processing }) => (
                        <>
                            <div className="flex-1">
                                <Field
                                    label="Email address"
                                    error={errors.email}
                                >
                                    <Input
                                        name="email"
                                        type="email"
                                        placeholder="name@studio.com"
                                        autoComplete="off"
                                        required
                                    />
                                </Field>
                            </div>
                            <Button type="submit" disabled={processing}>
                                <Send className="size-3.5" />
                                {processing ? 'Sending…' : 'Send invitation'}
                            </Button>
                        </>
                    )}
                </Form>

                <p className="mt-3 text-xs text-muted-foreground">
                    They get a link that puts them straight into the studio —
                    nothing to type. It works for two weeks, and signing up
                    through it joins them automatically.
                </p>
            </div>

            {invitations.length > 0 && (
                <>
                    <p className="ax-eyebrow border-t border-border px-5 pt-3 text-[0.6rem] text-muted-foreground">
                        Waiting · {invitations.length}
                    </p>
                    <ul className="divide-y divide-border">
                        {invitations.map((invitation) => (
                            <PendingInvitation
                                key={invitation.id}
                                invitation={invitation}
                            />
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}

function PendingInvitation({ invitation }: { invitation: SentInvitation }) {
    return (
        <li className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                    {invitation.email}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                    Expires {formatDate(invitation.expires_at)}
                    {invitation.inviter
                        ? ` · sent by ${invitation.inviter}`
                        : ''}
                </p>
            </div>

            <div className="flex shrink-0 items-center">
                <CopyButton
                    value={invitation.url}
                    title="Copy invitation link"
                    icon={<Link2 className="size-3.5" />}
                />
                <IconButton
                    title="Send it again"
                    onClick={() =>
                        router.post(
                            resendInvitation(invitation.id),
                            {},
                            { preserveScroll: true },
                        )
                    }
                >
                    <RotateCcw className="size-3.5" />
                </IconButton>
                <IconButton
                    title="Withdraw invitation"
                    onClick={() => {
                        if (
                            window.confirm(
                                `Withdraw the invitation to ${invitation.email}? Their link stops working.`,
                            )
                        ) {
                            router.delete(revokeInvitation(invitation.id), {
                                preserveScroll: true,
                            });
                        }
                    }}
                >
                    <X className="size-3.5" />
                </IconButton>
            </div>
        </li>
    );
}

/* ------------------------------------------------------------------ header */

function OrganizationHeader({
    organization,
}: {
    organization: OrganizationData;
}) {
    const [renaming, setRenaming] = useState(false);

    return (
        <>
            <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                <div>
                    <p className="ax-eyebrow text-muted-foreground">
                        Organization
                    </p>
                    <h1 className="mt-2 flex items-center gap-3 text-2xl font-light tracking-tight">
                        {organization.name}
                        {organization.is_head && (
                            <button
                                type="button"
                                onClick={() => setRenaming(true)}
                                title="Rename organization"
                                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                            >
                                <Pencil className="size-4" />
                            </button>
                        )}
                    </h1>
                    <div className="ax-rule mt-3" />
                    <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                        {organization.members.length}{' '}
                        {organization.members.length === 1
                            ? 'person'
                            : 'people'}{' '}
                        sharing every project, client and hour in the studio.
                    </p>
                </div>

                {organization.is_head ? (
                    <Button
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                            if (
                                window.confirm(
                                    `Disband "${organization.name}"? Everyone keeps their own drawings, but the shared view and the conversation are lost.`,
                                )
                            ) {
                                router.delete(destroy());
                            }
                        }}
                    >
                        Disband organization
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        onClick={() => {
                            if (
                                window.confirm(
                                    `Leave "${organization.name}"? You will keep your own drawings but lose access to the team's.`,
                                )
                            ) {
                                router.post(leave());
                            }
                        }}
                    >
                        <LogOut className="size-4" />
                        Leave
                    </Button>
                )}
            </header>

            <Dialog open={renaming} onOpenChange={setRenaming}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Rename organization</DialogTitle>
                        <DialogDescription>
                            This is the name everyone on the team sees.
                        </DialogDescription>
                    </DialogHeader>

                    <Form
                        action={update()}
                        method="put"
                        options={{ preserveScroll: true }}
                        onSuccess={() => setRenaming(false)}
                        className="space-y-4"
                    >
                        {({ errors, processing }) => (
                            <>
                                <Field label="Name" error={errors.name}>
                                    <Input
                                        name="name"
                                        defaultValue={organization.name}
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setRenaming(false)}
                                    >
                                        Cancel
                                    </Button>
                                    <Button type="submit" disabled={processing}>
                                        Save
                                    </Button>
                                </DialogFooter>
                            </>
                        )}
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    );
}

/* --------------------------------------------------------------- join code */

function JoinCodeCard({ code }: { code: string }) {
    return (
        <section className="rounded-lg border border-sand/40 bg-accent/40 p-5">
            <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-sand" />
                <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                    Join code
                </p>
            </div>

            <p className="mt-3 font-mono text-2xl tracking-[0.2em] text-foreground">
                {code}
            </p>

            <p className="mt-2 text-xs text-muted-foreground">
                For anyone you would rather not email. Entering it puts them
                straight into the studio.
            </p>

            <div className="mt-4 flex gap-2">
                <CopyButton
                    value={code}
                    title="Copy join code"
                    label="Copy code"
                    icon={<Copy className="size-3.5" />}
                />
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        if (
                            window.confirm(
                                'Issue a new code? The current one stops working immediately, but nobody already in the organization is removed.',
                            )
                        ) {
                            router.post(
                                regenerate(),
                                {},
                                { preserveScroll: true },
                            );
                        }
                    }}
                >
                    <RefreshCw className="size-3.5" />
                    New code
                </Button>
            </div>
        </section>
    );
}

/* ----------------------------------------------------------------- members */

function MemberList({ organization }: { organization: OrganizationData }) {
    return (
        <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <Users className="size-4 text-sand" />
                <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                    Members · {organization.members.length}
                </p>
            </div>

            <ul className="divide-y divide-border">
                {organization.members.map((member) => (
                    <li
                        key={member.id}
                        className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                        <div className="min-w-0">
                            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                                {member.name}
                                {member.is_me && (
                                    <span className="text-xs text-muted-foreground">
                                        (you)
                                    </span>
                                )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                                {member.email}
                            </p>
                        </div>

                        {member.is_head && (
                            <span className="flex shrink-0 items-center gap-1 rounded-sm border border-sand/50 px-1.5 py-0.5 text-[0.6rem] tracking-wide text-sand uppercase">
                                <Crown className="size-3" />
                                Head
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

/* -------------------------------------------------------------------- chat */

/**
 * Only ever mounted once there is an organization to poll for. Inertia's
 * usePoll reads its interval once, on mount, and has no guard against zero —
 * a falsy interval means setInterval(…, 0), which floods the server.
 */
function TeamChat({
    messages,
    name,
}: {
    messages: ChatMessage[];
    name: string;
}) {
    // Keep the conversation current without anyone reaching for refresh.
    usePoll(5000, { only: ['messages'] });

    const scrollRef = useRef<HTMLDivElement>(null);
    const latestId = messages.at(-1)?.id ?? 0;

    // Follow the conversation as it arrives.
    useEffect(() => {
        const container = scrollRef.current;

        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [latestId]);

    return (
        <section className="flex min-h-0 flex-col rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <p className="ax-eyebrow text-[0.6rem] text-muted-foreground">
                    Team chat
                </p>
                <p className="text-[0.65rem] text-muted-foreground">{name}</p>
            </div>

            <div
                ref={scrollRef}
                className="min-h-64 flex-1 space-y-3 overflow-y-auto px-5 py-4"
            >
                {messages.length === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                        Nothing said yet. Start the conversation.
                    </p>
                ) : (
                    messages.map((message, index) => (
                        <Bubble
                            key={message.id}
                            message={message}
                            showAuthor={
                                index === 0 ||
                                messages[index - 1].author !== message.author
                            }
                        />
                    ))
                )}
            </div>

            <Form
                action={postMessage()}
                method="post"
                options={{ preserveScroll: true, only: ['messages'] }}
                resetOnSuccess
                className="flex items-end gap-2 border-t border-border p-3"
            >
                {({ processing }) => (
                    <>
                        <textarea
                            name="body"
                            rows={1}
                            required
                            placeholder="Message the team…"
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

function Bubble({
    message,
    showAuthor,
}: {
    message: ChatMessage;
    showAuthor: boolean;
}) {
    return (
        <div
            className={cn(
                'flex flex-col',
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
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
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
    );
}

function formatTime(iso: string | null): string {
    if (!iso) {
        return '';
    }

    const date = new Date(iso);
    const sameDay = new Date().toDateString() === date.toDateString();

    return date.toLocaleTimeString('en-CA', {
        hour: 'numeric',
        minute: '2-digit',
        ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
    });
}

/* ------------------------------------------------------------------ shared */

function IconButton({
    title,
    onClick,
    children,
}: {
    title: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            onClick={onClick}
            className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
            {children}
        </button>
    );
}

/**
 * Copies a value and says so for a couple of seconds. Renders as a labelled
 * button when given a label, and as a bare icon otherwise.
 */
function CopyButton({
    value,
    title,
    icon,
    label,
}: {
    value: string;
    title: string;
    icon: React.ReactNode;
    label?: string;
}) {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) {
            return;
        }

        const timer = window.setTimeout(() => setCopied(false), 2000);

        return () => window.clearTimeout(timer);
    }, [copied]);

    const copy = () => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
    };

    const shown = copied ? <Check className="size-3.5" /> : icon;

    if (label === undefined) {
        return (
            <IconButton title={copied ? 'Copied' : title} onClick={copy}>
                {shown}
            </IconButton>
        );
    }

    return (
        <Button variant="outline" size="sm" title={title} onClick={copy}>
            {shown}
            {copied ? 'Copied' : label}
        </Button>
    );
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
    });
}

function Field({
    label,
    error,
    children,
}: {
    label: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid gap-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {label}
            </Label>
            {children}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}

OrganizationPage.layout = {
    breadcrumbs: [
        {
            title: 'Organization',
            href: show(),
        },
    ],
};
