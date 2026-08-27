import { Form, Head, Link, router } from '@inertiajs/react';
import {
    ChevronLeft,
    ChevronRight,
    Clock,
    MapPin,
    Plus,
    Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
import { calendar } from '@/routes';
import { destroy, store, update } from '@/routes/meetings';

/* ----------------------------------------------------------------- types */

type DayCell = {
    date: string;
    day: number;
    inMonth: boolean;
    today: boolean;
};

type MonthGrid = {
    value: string;
    label: string;
    previous: string;
    next: string;
    first: string;
    last: string;
    today: string;
    weeks: DayCell[][];
};

type Option = {
    id: number;
    name: string;
    number?: string | null;
};

type MeetingRow = {
    id: number;
    title: string;
    date: string;
    start_time: string;
    end_time: string | null;
    minutes: number;
    location: string | null;
    attendees: string | null;
    agenda: string | null;
    author: string | null;
    client_id: number | null;
    client_name: string | null;
    project_id: number | null;
    project_name: string | null;
};

type CalendarPageProps = {
    month: MonthGrid;
    meetings: MeetingRow[];
    upcoming: MeetingRow[];
    clients: Option[];
    projects: Option[];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ------------------------------------------------------------------ page */

export default function CalendarIndex({
    month,
    meetings,
    upcoming,
    clients,
    projects,
}: CalendarPageProps) {
    // A new booking carries the day that was clicked; an edit carries the
    // whole meeting. Only one of the two is ever open.
    const [booking, setBooking] = useState<string | null>(null);
    const [editing, setEditing] = useState<MeetingRow | null>(null);

    const byDay = useMemo(() => {
        const grouped = new Map<string, MeetingRow[]>();

        for (const meeting of meetings) {
            const day = grouped.get(meeting.date);

            if (day) {
                day.push(meeting);
            } else {
                grouped.set(meeting.date, [meeting]);
            }
        }

        return grouped;
    }, [meetings]);

    return (
        <>
            <Head title="Calendar" />

            <div className="flex h-full flex-1 flex-col gap-8 p-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
                    <div>
                        <p className="ax-eyebrow text-muted-foreground">Axon</p>
                        <h1 className="mt-2 text-2xl font-light tracking-tight">
                            Calendar
                        </h1>
                        <div className="ax-rule mt-3" />
                        <p className="mt-4 max-w-xl text-sm text-muted-foreground">
                            Client meetings, site walks and consultant
                            coordination, kept beside the drawings they are
                            about. Times are the studio's own clock — three
                            o'clock reads as three o'clock on every machine.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <MonthNav month={month} />
                        <Button onClick={() => setBooking(month.today)}>
                            <Plus className="size-4" />
                            Book meeting
                        </Button>
                    </div>
                </header>

                <div className="grid flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                    <MonthTable
                        month={month}
                        byDay={byDay}
                        onPickDay={setBooking}
                        onPickMeeting={setEditing}
                    />

                    <Agenda
                        meetings={upcoming}
                        today={month.today}
                        onPickMeeting={setEditing}
                    />
                </div>
            </div>

            <MeetingDialog
                open={booking !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setBooking(null);
                    }
                }}
                meeting={null}
                date={booking ?? month.today}
                clients={clients}
                projects={projects}
            />

            <MeetingDialog
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setEditing(null);
                    }
                }}
                meeting={editing}
                date={editing?.date ?? month.today}
                clients={clients}
                projects={projects}
            />
        </>
    );
}

/* -------------------------------------------------------------- the grid */

function MonthNav({ month }: { month: MonthGrid }) {
    return (
        <div className="flex items-center gap-1">
            <Link
                href={calendar({ query: { month: month.previous } })}
                prefetch
                preserveScroll
                aria-label="Previous month"
                title="Previous month"
                className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
                <ChevronLeft className="size-4" />
            </Link>

            <p className="w-36 text-center text-sm font-medium">
                {month.label}
            </p>

            <Link
                href={calendar({ query: { month: month.next } })}
                prefetch
                preserveScroll
                aria-label="Next month"
                title="Next month"
                className="rounded-sm p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
                <ChevronRight className="size-4" />
            </Link>

            <Button
                variant="outline"
                size="sm"
                className="ml-2"
                onClick={() =>
                    router.get(
                        calendar({ query: { month: month.today.slice(0, 7) } }),
                        {},
                        { preserveScroll: true },
                    )
                }
            >
                Today
            </Button>
        </div>
    );
}

function MonthTable({
    month,
    byDay,
    onPickDay,
    onPickMeeting,
}: {
    month: MonthGrid;
    byDay: Map<string, MeetingRow[]>;
    onPickDay: (date: string) => void;
    onPickMeeting: (meeting: MeetingRow) => void;
}) {
    return (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-7 border-b border-border bg-muted/30">
                {WEEKDAYS.map((weekday) => (
                    <p
                        key={weekday}
                        className="ax-eyebrow px-2 py-2.5 text-center text-muted-foreground"
                    >
                        <span className="hidden sm:inline">{weekday}</span>
                        <span className="sm:hidden">{weekday.charAt(0)}</span>
                    </p>
                ))}
            </div>

            <div className="grid grid-cols-7">
                {month.weeks.flat().map((cell) => (
                    <DayCellView
                        key={cell.date}
                        cell={cell}
                        meetings={byDay.get(cell.date) ?? []}
                        onPickDay={onPickDay}
                        onPickMeeting={onPickMeeting}
                    />
                ))}
            </div>
        </section>
    );
}

function DayCellView({
    cell,
    meetings,
    onPickDay,
    onPickMeeting,
}: {
    cell: DayCell;
    meetings: MeetingRow[];
    onPickDay: (date: string) => void;
    onPickMeeting: (meeting: MeetingRow) => void;
}) {
    return (
        <div
            className={cn(
                'flex min-h-28 flex-col gap-1 border-r border-b border-border p-1.5 last:border-r-0',
                cell.inMonth ? 'bg-card' : 'bg-muted/20',
            )}
        >
            <div className="flex items-baseline justify-between px-0.5">
                <span
                    className={cn(
                        'text-xs tabular-nums',
                        cell.today
                            ? 'flex size-5 items-center justify-center rounded-full bg-ember font-medium text-white'
                            : cell.inMonth
                              ? 'text-foreground'
                              : 'text-muted-foreground/50',
                    )}
                >
                    {cell.day}
                </span>

                {meetings.length > 2 && (
                    <span className="text-[0.65rem] text-muted-foreground tabular-nums">
                        {meetings.length}
                    </span>
                )}
            </div>

            <div className="flex max-h-24 flex-col gap-1 overflow-y-auto">
                {meetings.map((meeting) => (
                    <button
                        key={meeting.id}
                        type="button"
                        onClick={() => onPickMeeting(meeting)}
                        title={`${formatClock(meeting.start_time)} — ${meeting.title}`}
                        className="rounded-sm border-l-2 border-sand bg-accent/60 px-1.5 py-1 text-left transition-colors hover:bg-accent"
                    >
                        <span className="block truncate text-[0.7rem] font-medium">
                            {meeting.title}
                        </span>
                        <span className="block truncate text-[0.65rem] text-muted-foreground">
                            {formatClock(meeting.start_time)}
                            {meeting.client_name
                                ? ` · ${meeting.client_name}`
                                : ''}
                        </span>
                    </button>
                ))}
            </div>

            <button
                type="button"
                onClick={() => onPickDay(cell.date)}
                aria-label={`Book a meeting on ${fullDayLabel(cell.date)}`}
                title={`Book a meeting on ${fullDayLabel(cell.date)}`}
                className="min-h-5 flex-1 rounded-sm text-muted-foreground/0 transition-colors hover:bg-accent/40 hover:text-muted-foreground"
            >
                <Plus className="mx-auto size-3.5" />
            </button>
        </div>
    );
}

/* ------------------------------------------------------------ the agenda */

function Agenda({
    meetings,
    today,
    onPickMeeting,
}: {
    meetings: MeetingRow[];
    today: string;
    onPickMeeting: (meeting: MeetingRow) => void;
}) {
    return (
        <aside className="rounded-lg border border-border bg-card p-4">
            <h2 className="ax-eyebrow text-muted-foreground">Coming up</h2>

            {meetings.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                    Nothing booked in the next thirty days. Click any day on the
                    calendar to put something in.
                </p>
            ) : (
                <ul className="mt-4 space-y-3">
                    {meetings.map((meeting) => (
                        <li key={meeting.id}>
                            <button
                                type="button"
                                onClick={() => onPickMeeting(meeting)}
                                className="w-full rounded-md border border-border p-3 text-left transition-colors hover:border-ring/50 hover:bg-accent/40"
                            >
                                <p className="flex items-baseline justify-between gap-2">
                                    <span className="truncate text-sm font-medium">
                                        {meeting.title}
                                    </span>
                                    <span
                                        className={cn(
                                            'shrink-0 text-[0.7rem]',
                                            meeting.date === today
                                                ? 'font-medium text-ember'
                                                : 'text-muted-foreground',
                                        )}
                                    >
                                        {meeting.date === today
                                            ? 'Today'
                                            : shortDayLabel(meeting.date)}
                                    </span>
                                </p>

                                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="size-3 shrink-0 text-sand" />
                                    {formatSpan(meeting)}
                                </p>

                                {(meeting.client_name ||
                                    meeting.project_name) && (
                                    <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                                        {[
                                            meeting.client_name,
                                            meeting.project_name,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                )}

                                {meeting.location && (
                                    <p className="mt-0.5 flex items-center gap-1 truncate text-[0.7rem] text-muted-foreground">
                                        <MapPin className="size-3 shrink-0" />
                                        {meeting.location}
                                    </p>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </aside>
    );
}

/* ------------------------------------------------------------- the form */

function MeetingDialog({
    open,
    onOpenChange,
    meeting,
    date,
    clients,
    projects,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    meeting: MeetingRow | null;
    date: string;
    clients: Option[];
    projects: Option[];
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        {meeting ? 'Edit meeting' : 'Book a meeting'}
                    </DialogTitle>
                    <DialogDescription>
                        {meeting
                            ? 'Change the day or the hour and everyone in the studio sees the move.'
                            : `Putting something in the diary for ${fullDayLabel(date)}.`}
                    </DialogDescription>
                </DialogHeader>

                <Form
                    key={meeting?.id ?? date}
                    action={meeting ? update(meeting.id) : store()}
                    method={meeting ? 'put' : 'post'}
                    options={{ preserveScroll: true }}
                    onSuccess={() => onOpenChange(false)}
                    resetOnSuccess
                    className="space-y-4"
                >
                    {({ errors, processing }) => (
                        <>
                            <Field label="What is it" error={errors.title}>
                                <Input
                                    name="title"
                                    defaultValue={meeting?.title ?? ''}
                                    placeholder="Design review with the Chens"
                                    autoFocus
                                    required
                                />
                            </Field>

                            <div className="grid gap-4 sm:grid-cols-3">
                                <Field label="Day" error={errors.date}>
                                    <Input
                                        type="date"
                                        name="date"
                                        defaultValue={meeting?.date ?? date}
                                        required
                                    />
                                </Field>
                                <Field label="From" error={errors.start_time}>
                                    <Input
                                        type="time"
                                        name="start_time"
                                        defaultValue={
                                            meeting?.start_time ?? '09:00'
                                        }
                                        required
                                    />
                                </Field>
                                <Field label="To" error={errors.end_time}>
                                    <Input
                                        type="time"
                                        name="end_time"
                                        defaultValue={meeting?.end_time ?? ''}
                                    />
                                </Field>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Client" error={errors.client_id}>
                                    <Picker
                                        name="client_id"
                                        blank="No client"
                                        options={clients}
                                        selected={meeting?.client_id ?? null}
                                    />
                                </Field>
                                <Field
                                    label="Drawing"
                                    error={errors.project_id}
                                >
                                    <Picker
                                        name="project_id"
                                        blank="No drawing"
                                        options={projects}
                                        selected={meeting?.project_id ?? null}
                                    />
                                </Field>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label="Where" error={errors.location}>
                                    <Input
                                        name="location"
                                        defaultValue={meeting?.location ?? ''}
                                        placeholder="Studio, or the site"
                                    />
                                </Field>
                                <Field label="Who" error={errors.attendees}>
                                    <Input
                                        name="attendees"
                                        defaultValue={meeting?.attendees ?? ''}
                                        placeholder="Margaret, structural engineer"
                                    />
                                </Field>
                            </div>

                            <Field label="Agenda" error={errors.agenda}>
                                <textarea
                                    name="agenda"
                                    defaultValue={meeting?.agenda ?? ''}
                                    rows={4}
                                    placeholder="What needs deciding before you leave the room."
                                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-xs outline-none focus-visible:border-ring"
                                />
                            </Field>

                            <DialogFooter className="sm:justify-between">
                                {meeting ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => {
                                            if (
                                                window.confirm(
                                                    `Cancel “${meeting.title}”? It will be taken out of the diary.`,
                                                )
                                            ) {
                                                onOpenChange(false);
                                                router.delete(
                                                    destroy(meeting.id),
                                                    { preserveScroll: true },
                                                );
                                            }
                                        }}
                                    >
                                        <Trash2 className="size-4" />
                                        Cancel meeting
                                    </Button>
                                ) : (
                                    <span />
                                )}

                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => onOpenChange(false)}
                                    >
                                        Close
                                    </Button>
                                    <Button type="submit" disabled={processing}>
                                        {processing
                                            ? 'Saving…'
                                            : meeting
                                              ? 'Save changes'
                                              : 'Book it'}
                                    </Button>
                                </div>
                            </DialogFooter>
                        </>
                    )}
                </Form>
            </DialogContent>
        </Dialog>
    );
}

/* --------------------------------------------------------------- shared */

function Picker({
    name,
    blank,
    options,
    selected,
}: {
    name: string;
    blank: string;
    options: Option[];
    selected: number | null;
}) {
    return (
        <select
            name={name}
            defaultValue={selected ? String(selected) : ''}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring"
        >
            <option value="">{blank}</option>
            {options.map((option) => (
                <option key={option.id} value={option.id}>
                    {option.number
                        ? `${option.number} — ${option.name}`
                        : option.name}
                </option>
            ))}
        </select>
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

/* ---------------------------------------------------------------- clock */

/**
 * Times arrive as bare `HH:MM` strings and are formatted by hand. Passing
 * them through `Date` would drag them into the browser's timezone, which is
 * exactly what the studio clock is meant to avoid.
 */
function formatClock(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const suffix = hours < 12 ? 'am' : 'pm';
    const hour = hours % 12 === 0 ? 12 : hours % 12;

    return minutes === 0
        ? `${hour} ${suffix}`
        : `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function formatSpan(meeting: MeetingRow): string {
    const from = formatClock(meeting.start_time);

    return meeting.end_time
        ? `${from} – ${formatClock(meeting.end_time)}`
        : from;
}

/**
 * A `YYYY-MM-DD` day named for a person. Built through the local Date
 * constructor rather than a parsed string, which would be read as UTC and
 * could land on the day before.
 */
function toLocalDate(date: string): Date {
    const [year, month, day] = date.split('-').map(Number);

    return new Date(year, month - 1, day);
}

function fullDayLabel(date: string): string {
    return toLocalDate(date).toLocaleDateString('en-CA', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
    });
}

function shortDayLabel(date: string): string {
    return toLocalDate(date).toLocaleDateString('en-CA', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

CalendarIndex.layout = {
    breadcrumbs: [
        {
            title: 'Calendar',
            href: calendar(),
        },
    ],
};
