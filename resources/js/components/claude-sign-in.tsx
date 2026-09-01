import { Form } from '@inertiajs/react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    destroy as signOutRoute,
    store as signInRoute,
} from '@/routes/claude-account';

export type ClaudeState = {
    /** The CLI is on the machine serving Vanhaven and answers. */
    installed: boolean;
    /** This person has connected their own Claude account. */
    signedIn: boolean;
};

type ClaudeSignInProps = {
    claude: ClaudeState;
    /**
     * The chrome to wear. The editor's dock and the designer's terminal are
     * dark panels; everywhere else follows the page.
     */
    tone?: 'chrome' | 'page';
};

/**
 * Signing in to Claude with your own account.
 *
 * Turns are drawn from a Claude subscription, so they come out of the
 * subscription of whoever asked — never the machine owner's, and never a
 * colleague's. That means a personal sign-in rather than a shared server
 * setting: `claude setup-token` mints a token against your plan, and this is
 * where it goes. It is encrypted at rest and never sent back to the browser.
 *
 * Two things have to be true and they fail differently, so they are asked for
 * separately: the CLI has to be on the machine serving the app, and you have
 * to be signed in. Being told to install what you already have helps nobody.
 */
export function ClaudeSignIn({ claude, tone = 'chrome' }: ClaudeSignInProps) {
    const dark = tone === 'chrome';

    const shell = dark
        ? 'border-chrome-border text-chrome-muted'
        : 'border-border text-muted-foreground';
    const strong = dark ? 'text-chrome-fg' : 'text-foreground';
    const field = dark
        ? 'border-chrome-border bg-chrome-sunken text-chrome-fg placeholder:text-chrome-muted'
        : 'border-border bg-background text-foreground placeholder:text-muted-foreground';

    if (!claude.installed) {
        return (
            <div
                className={cn(
                    'space-y-2 rounded-sm border px-2.5 py-2 text-[0.73rem] leading-relaxed',
                    shell,
                )}
            >
                <p className={strong}>Claude Code is not on this machine.</p>
                <p>
                    Vanhaven runs the CLI on the computer serving it. Install
                    it, then sign in below.
                </p>
                <code className="block text-sand">
                    npm i -g @anthropic-ai/claude-code
                </code>
            </div>
        );
    }

    if (claude.signedIn) {
        return (
            <div
                className={cn(
                    'flex items-center justify-between gap-2 rounded-sm border px-2.5 py-2 text-[0.73rem]',
                    shell,
                )}
            >
                <span className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5 text-sand" />
                    <span className={strong}>Signed in to Claude</span>
                </span>

                <Form
                    {...signOutRoute.form()}
                    options={{ preserveScroll: true }}
                >
                    <button
                        type="submit"
                        className="flex items-center gap-1 rounded-sm px-1.5 py-1 transition-colors hover:text-destructive"
                    >
                        <LogOut className="size-3" />
                        Sign out
                    </button>
                </Form>
            </div>
        );
    }

    return (
        <Form
            {...signInRoute.form()}
            options={{ preserveScroll: true }}
            resetOnSuccess
            className={cn(
                'space-y-2 rounded-sm border px-2.5 py-2 text-[0.73rem] leading-relaxed',
                shell,
            )}
        >
            {({ processing, errors }) => (
                <>
                    <p className={cn('flex items-center gap-1.5', strong)}>
                        <KeyRound className="size-3.5 text-sand" />
                        Sign in with your Claude account
                    </p>

                    <p>
                        Turns come out of your own subscription, so the account
                        has to be yours. In a terminal run:
                    </p>

                    <code className="block text-sand">claude setup-token</code>

                    <p>and paste what it prints.</p>

                    <input
                        name="token"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="sk-ant-oat…"
                        className={cn(
                            'w-full rounded-sm border px-2 py-1.5 font-mono text-[0.72rem] focus:border-sand/60 focus:outline-none',
                            field,
                        )}
                    />

                    {errors.token !== undefined && (
                        <p className="text-destructive">{errors.token}</p>
                    )}

                    <button
                        type="submit"
                        disabled={processing}
                        className="w-full rounded-sm border border-sand/60 bg-sand/15 px-2 py-1.5 text-sand transition-colors hover:bg-sand/25 disabled:opacity-50"
                    >
                        {processing ? 'Checking…' : 'Connect'}
                    </button>

                    <p className="text-[0.66rem]">
                        The token is checked before it is kept, encrypted at
                        rest, and never sent back to this page.
                    </p>
                </>
            )}
        </Form>
    );
}
