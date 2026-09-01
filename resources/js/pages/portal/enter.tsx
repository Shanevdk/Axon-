import { Form, Head, usePage } from '@inertiajs/react';
import { useState } from 'react';
import AppLogoIcon from '@/components/app-logo-icon';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { open } from '@/routes/portal';

/** Twelve digits read best in three groups of four, the way it is printed. */
function group(value: string): string {
    const digits = value.replace(/\D/g, '').slice(0, 12);

    return digits.replace(/(.{4})(?=.)/g, '$1-');
}

type SharedProps = {
    name: string;
};

export default function PortalEnter() {
    const { name } = usePage<SharedProps>().props;
    const [number, setNumber] = useState('');

    return (
        <>
            <Head title="Client portal" />

            <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
                <div className="w-full max-w-sm">
                    <div className="flex flex-col gap-8">
                        <div className="flex flex-col items-center gap-4">
                            <div className="flex size-9 items-center justify-center rounded-md text-sand">
                                <AppLogoIcon className="size-9 fill-current" />
                            </div>

                            <div className="space-y-2 text-center">
                                <p className="ax-eyebrow text-muted-foreground">
                                    {name}
                                </p>
                                <h1 className="text-xl font-medium">
                                    See how your house is coming along
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    Enter the number your architect gave you.
                                </p>
                            </div>
                        </div>

                        <Form
                            {...open.form()}
                            className="flex flex-col gap-6"
                            onSuccess={() => setNumber('')}
                        >
                            {({ processing, errors }) => (
                                <>
                                    <div className="grid gap-2">
                                        <Label htmlFor="number">
                                            Your number
                                        </Label>
                                        <Input
                                            id="number"
                                            name="number"
                                            required
                                            autoFocus
                                            inputMode="numeric"
                                            autoComplete="off"
                                            placeholder="0000-0000-0000"
                                            className="text-center font-mono text-lg tracking-widest"
                                            value={number}
                                            onChange={(event) =>
                                                setNumber(
                                                    group(event.target.value),
                                                )
                                            }
                                        />
                                        <InputError message={errors.number} />
                                    </div>

                                    <Button
                                        type="submit"
                                        className="w-full"
                                        disabled={processing}
                                    >
                                        Open my project
                                    </Button>

                                    <p className="text-center text-sm text-muted-foreground">
                                        Lost the number? Ask your architect —
                                        they can read it out or issue a new one.
                                    </p>
                                </>
                            )}
                        </Form>
                    </div>
                </div>
            </div>
        </>
    );
}
