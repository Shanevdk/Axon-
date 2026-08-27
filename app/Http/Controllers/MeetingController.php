<?php

namespace App\Http\Controllers;

use App\Actions\Calendar\BuildMonthGrid;
use App\Http\Requests\StoreMeetingRequest;
use App\Http\Requests\UpdateMeetingRequest;
use App\Models\Client;
use App\Models\Meeting;
use App\Models\Project;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class MeetingController extends Controller
{
    /**
     * How far ahead the agenda rail looks, and how many bookings it shows.
     */
    private const AGENDA_DAYS = 30;

    private const AGENDA_LIMIT = 12;

    /**
     * The studio diary, a month at a time.
     */
    public function index(Request $request, BuildMonthGrid $grid): Response
    {
        $month = $grid->handle($request->string('month')->toString() ?: null);

        $meetings = $request->user()
            ->teamMeetings()
            ->with(['user:id,name', 'client:id,name', 'project:id,name,number'])
            ->betweenDays($month['first'], $month['last'])
            ->get();

        return Inertia::render('calendar/index', [
            'month' => $month,
            'meetings' => $meetings->map(fn (Meeting $meeting): array => $this->row($meeting)),
            'upcoming' => $this->upcoming($request),
            'clients' => $this->clients($request),
            'projects' => $this->drawings($request),
        ]);
    }

    /**
     * Book a meeting.
     */
    public function store(StoreMeetingRequest $request): RedirectResponse
    {
        $request->user()->meetings()->create($request->booking());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Meeting booked.')]);

        return back();
    }

    /**
     * Move or rewrite a meeting.
     */
    public function update(UpdateMeetingRequest $request, Meeting $meeting): RedirectResponse
    {
        $meeting->update($request->booking());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Meeting updated.')]);

        return back();
    }

    /**
     * Cancel a meeting.
     */
    public function destroy(Meeting $meeting): RedirectResponse
    {
        Gate::authorize('delete', $meeting);

        $meeting->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Meeting cancelled.')]);

        return back();
    }

    /**
     * What is coming up, regardless of which month is on screen.
     *
     * @return array<int, array<string, mixed>>
     */
    private function upcoming(Request $request): array
    {
        $today = Carbon::today();

        return $request->user()
            ->teamMeetings()
            ->with(['user:id,name', 'client:id,name', 'project:id,name,number'])
            ->betweenDays(
                $today->format('Y-m-d'),
                $today->copy()->addDays(self::AGENDA_DAYS)->format('Y-m-d'),
            )
            ->limit(self::AGENDA_LIMIT)
            ->get()
            ->map(fn (Meeting $meeting): array => $this->row($meeting))
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Meeting $meeting): array
    {
        return [
            'id' => $meeting->id,
            'title' => $meeting->title,

            // Split rather than sent as a timestamp: the browser must not
            // shift a studio wall-clock time into its own timezone.
            'date' => $meeting->day(),
            'start_time' => $meeting->starts_at->format('H:i'),
            'end_time' => $meeting->ends_at?->format('H:i'),
            'minutes' => $meeting->minutes(),

            'location' => $meeting->location,
            'attendees' => $meeting->attendees,
            'agenda' => $meeting->agenda,
            'author' => $meeting->user?->name,
            'client_id' => $meeting->client_id,
            'client_name' => $meeting->client?->name,
            'project_id' => $meeting->project_id,
            'project_name' => $meeting->project?->name,
        ];
    }

    /**
     * @return array<int, array{id: int, name: string}>
     */
    private function clients(Request $request): array
    {
        return $request->user()
            ->teamClients()
            ->orderBy('name')
            ->get(['id', 'name'])
            ->map(fn (Client $client): array => [
                'id' => $client->id,
                'name' => $client->name,
            ])
            ->all();
    }

    /**
     * @return array<int, array{id: int, name: string, number: string|null}>
     */
    private function drawings(Request $request): array
    {
        return $request->user()
            ->teamProjects()
            ->orderBy('name')
            ->get(['id', 'name', 'number'])
            ->map(fn (Project $project): array => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
            ])
            ->all();
    }
}
