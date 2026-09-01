import { Form } from '@inertiajs/react';
import { useState } from 'react';
import { SitePicker } from '@/components/site-picker';
import type { SiteSelection } from '@/components/site-picker';
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
import { update } from '@/routes/projects';

export type ProjectSummary = {
    id: number;
    name: string;
    number: string | null;
    client: string | null;
    address: string | null;
    /** Where the building is, for the code the assistant answers under. */
    jurisdiction: string | null;
    /** The spot on the map, once one has been picked. */
    latitude: number | null;
    longitude: number | null;
    units: 'metric' | 'imperial';
};

type ProjectInfoDialogProps = {
    project: ProjectSummary;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function ProjectInfoDialog({
    project,
    open,
    onOpenChange,
}: ProjectInfoDialogProps) {
    const [site, setSite] = useState<SiteSelection>({
        address: project.address ?? '',
        latitude: project.latitude,
        longitude: project.longitude,
        region: project.jurisdiction,
    });

    const [jurisdiction, setJurisdiction] = useState(
        project.jurisdiction ?? '',
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Project Information</DialogTitle>
                    <DialogDescription>
                        These fields feed the title block and the schedule
                        headers.
                    </DialogDescription>
                </DialogHeader>

                <Form
                    action={update(project.id)}
                    method="put"
                    options={{ preserveScroll: true }}
                    onSuccess={() => onOpenChange(false)}
                    className="space-y-4"
                >
                    {({ errors, processing }) => (
                        <>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Project name" error={errors.name}>
                                    <Input
                                        name="name"
                                        defaultValue={project.name}
                                        required
                                    />
                                </Field>
                                <Field
                                    label="Project number"
                                    error={errors.number}
                                >
                                    <Input
                                        name="number"
                                        defaultValue={project.number ?? ''}
                                    />
                                </Field>
                                <Field label="Client" error={errors.client}>
                                    <Input
                                        name="client"
                                        defaultValue={project.client ?? ''}
                                    />
                                </Field>
                                <Field label="Units" error={errors.units}>
                                    <select
                                        name="units"
                                        defaultValue={project.units}
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

                            <SitePicker
                                value={site}
                                onChange={(next) => {
                                    setSite(next);

                                    // Choosing a place from the search knows
                                    // the jurisdiction; moving the pin does
                                    // not, and must not wipe what is there.
                                    if (next.region !== null) {
                                        setJurisdiction(next.region);
                                    }
                                }}
                                error={
                                    errors.address ??
                                    errors.latitude ??
                                    errors.longitude
                                }
                            />

                            <Field
                                label="Jurisdiction"
                                error={errors.jurisdiction}
                                hint="The city, province or state, and country. Decides which building and fire code the assistant answers under. Filled in when you pick an address."
                            >
                                <Input
                                    name="jurisdiction"
                                    value={jurisdiction}
                                    onChange={(event) =>
                                        setJurisdiction(event.target.value)
                                    }
                                    placeholder="Kelowna, British Columbia, Canada"
                                />
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
                                    {processing ? 'Saving…' : 'Save'}
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

function Field({
    label,
    error,
    hint,
    children,
}: {
    label: string;
    error?: string;
    hint?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid gap-1.5">
            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                {label}
            </Label>
            {children}
            {hint && !error && (
                <p className="text-xs text-muted-foreground">{hint}</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
