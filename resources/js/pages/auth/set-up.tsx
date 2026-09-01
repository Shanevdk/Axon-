import { Form, Head } from '@inertiajs/react';
import InputError from '@/components/input-error';
import PasswordInput from '@/components/password-input';
import TextLink from '@/components/text-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { login } from '@/routes';
import { open } from '@/routes/invitations';

type Props = {
    passwordRules: string;
    /** The address the invitation was sent to. Settled, so not editable. */
    email: string;
    organization: string;
};

/**
 * Where an invited person opens their account.
 *
 * Nobody signs themselves up for Vanhaven, so this is the only page that makes a
 * user. The address is fixed by the invitation — all that is asked for is a
 * name and a password.
 */
export default function SetUp({ passwordRules, email, organization }: Props) {
    return (
        <>
            <Head title="Set up your account" />

            <div className="mb-6 rounded-md border border-sand/40 bg-accent/40 p-4 text-sm">
                <p className="font-medium">
                    You have been invited to {organization}
                </p>
                <p className="mt-1 text-muted-foreground">
                    Set a password and you are in — no sign-up needed.
                </p>
            </div>

            <Form
                {...open.form()}
                resetOnSuccess={['password', 'password_confirmation']}
                disableWhileProcessing
                className="flex flex-col gap-6"
            >
                {({ processing, errors }) => (
                    <>
                        <div className="grid gap-6">
                            <div className="grid gap-2">
                                <Label htmlFor="email">Email address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={email}
                                    readOnly
                                    disabled
                                    className="opacity-70"
                                />
                                <p className="text-xs text-muted-foreground">
                                    The address your invitation was sent to.
                                </p>
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="name">Your name</Label>
                                <Input
                                    id="name"
                                    type="text"
                                    required
                                    autoFocus
                                    tabIndex={1}
                                    autoComplete="name"
                                    name="name"
                                    placeholder="Full name"
                                />
                                <InputError message={errors.name} />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="password">Password</Label>
                                <PasswordInput
                                    id="password"
                                    required
                                    tabIndex={2}
                                    autoComplete="new-password"
                                    name="password"
                                    placeholder="Password"
                                    passwordrules={passwordRules}
                                />
                                <InputError message={errors.password} />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="password_confirmation">
                                    Confirm password
                                </Label>
                                <PasswordInput
                                    id="password_confirmation"
                                    required
                                    tabIndex={3}
                                    autoComplete="new-password"
                                    name="password_confirmation"
                                    placeholder="Confirm password"
                                    passwordrules={passwordRules}
                                />
                                <InputError
                                    message={errors.password_confirmation}
                                />
                            </div>

                            <Button
                                type="submit"
                                className="mt-2 w-full"
                                tabIndex={4}
                                data-test="set-up-account-button"
                            >
                                {processing && <Spinner />}
                                Open my account
                            </Button>
                        </div>

                        <div className="text-center text-sm text-muted-foreground">
                            Already have an account?{' '}
                            <TextLink href={login()} tabIndex={5}>
                                Log in
                            </TextLink>
                        </div>
                    </>
                )}
            </Form>
        </>
    );
}

SetUp.layout = {
    title: 'Set up your account',
    description: 'Your studio has invited you to Vanhaven',
};
