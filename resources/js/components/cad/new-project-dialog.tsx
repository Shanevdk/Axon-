import { Form } from '@inertiajs/react';
import { useState } from 'react';
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
import { store } from '@/routes/projects';

type NewProjectDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function NewProjectDialog({
    open,
    onOpenChange,
}: NewProjectDialogProps) {
    const [template, setTemplate] = useState<'residence' | 'blank'>(
        'residence',
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>New project</DialogTitle>
                    <DialogDescription>
                        Pick a template — you can change any of this later from
                        Project Information.
                    </DialogDescription>
                </DialogHeader>

                <Form action={store()} method="post" className="space-y-4">
                    {({ errors, processing }) => (
                        <>
                            <input
                                type="hidden"
                                name="template"
                                value={template}
                            />

                            <div className="grid gap-2 sm:grid-cols-2">
                                <TemplateOption
                                    active={template === 'residence'}
                                    title="Sample residence"
                                    description="A 12 × 9 m single storey plan with rooms and openings"
                                    onSelect={() => setTemplate('residence')}
                                />
                                <TemplateOption
                                    active={template === 'blank'}
                                    title="Blank model"
                                    description="Three levels and the standard wall types, nothing drawn"
                                    onSelect={() => setTemplate('blank')}
                                />
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Project name" error={errors.name}>
                                    <Input
                                        name="name"
                                        defaultValue="New Residence"
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Project number"
                                    error={errors.number}
                                >
                                    <Input
                                        name="number"
                                        defaultValue=""
                                        placeholder="2601"
                                    />
                                </Field>
                                <Field label="Client" error={errors.client}>
                                    <Input name="client" defaultValue="" />
                                </Field>
                                <Field label="Units" error={errors.units}>
                                    <select
                                        name="units"
                                        defaultValue="metric"
                                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring"
                                    >
                                        <option value="metric">
                                            Metric (mm)
                                        </option>
                                        <option value="imperial">
                                            Imperial (ft-in)
                                        </option>
                                    </select>
                                </Field>
                            </div>

                            <Field label="Site address" error={errors.address}>
                                <Input name="address" defaultValue="" />
                            </Field>

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => onOpenChange(false)}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={processing}>
                                    {processing
                                        ? 'Creating…'
                                        : 'Create and open'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

function TemplateOption({
    active,
    title,
    description,
    onSelect,
}: {
    active: boolean;
    title: string;
    description: string;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'rounded-md border p-3 text-left transition-colors',
                active
                    ? 'border-sand bg-accent'
                    : 'border-border hover:border-sand/60 hover:bg-accent/50',
            )}
        >
            <p className="text-sm font-medium">{title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </button>
    );
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
