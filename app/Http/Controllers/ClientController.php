<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreClientRequest;
use App\Http\Requests\UpdateClientRequest;
use App\Models\Client;
use App\Models\ClientComment;
use App\Models\Project;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class ClientController extends Controller
{
    /**
     * The client register: every client with their drawings and hours.
     */
    public function index(Request $request): Response
    {
        $clients = $request->user()
            ->teamClients()
            ->with([
                'projects' => fn ($query) => $query->latest('worked_at')->latest('id'),
                'projects.comments' => fn ($query) => $query->latest('id'),
            ])
            ->orderBy('name')
            ->get();

        $unassigned = $request->user()
            ->teamProjects()
            ->whereNull('client_id')
            ->latest('opened_at')
            ->latest('id')
            ->get();

        return Inertia::render('clients/index', [
            'clients' => $clients->map(fn (Client $client): array => [
                'id' => $client->id,
                'name' => $client->name,
                'company' => $client->company,
                'email' => $client->email,
                'phone' => $client->phone,
                'notes' => $client->notes,
                'portal_username' => $client->portal_username,
                'portal_number' => $client->formattedPortalNumber(),
                'portal_url' => route('portal.enter'),
                'portal_seen_at' => $client->portal_seen_at?->toIso8601String(),
                'total_seconds' => $client->totalWorkedSeconds(),
                'last_worked_at' => $client->lastWorkedAt()?->toIso8601String(),
                'projects' => $client->projects->map(
                    fn (Project $project): array => $this->projectRow($project),
                ),
            ]),
            'unassigned' => $unassigned->map(
                fn (Project $project): array => $this->projectRow($project),
            ),
        ]);
    }

    /**
     * Add a client to the register.
     */
    public function store(StoreClientRequest $request): RedirectResponse
    {
        $request->user()->clients()->create($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Client added.')]);

        return back();
    }

    /**
     * Update a client's details, carrying the name onto their drawings.
     */
    public function update(UpdateClientRequest $request, Client $client): RedirectResponse
    {
        $client->update($request->validated());

        // The display name on dashboards and title blocks follows the record.
        $client->projects()->update(['client' => $client->name]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Client updated.')]);

        return back();
    }

    /**
     * Remove a client. Their drawings stay, unassigned.
     */
    public function destroy(Client $client): RedirectResponse
    {
        Gate::authorize('delete', $client);

        $client->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Client removed.')]);

        return back();
    }

    /**
     * Issue the client a new portal number, retiring the old one at once.
     */
    public function reissueNumber(Client $client): RedirectResponse
    {
        Gate::authorize('update', $client);

        $client->reissuePortalNumber();

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('New number issued. The old one no longer works.'),
        ]);

        return back();
    }

    /**
     * Assign one of the user's drawings to this client.
     */
    public function assign(Request $request, Client $client): RedirectResponse
    {
        Gate::authorize('update', $client);

        $validated = $request->validate([
            'project_id' => [
                'required',
                Rule::exists('projects', 'id')->whereIn('user_id', $request->user()->teamMemberIds()),
            ],
        ]);

        Project::query()
            ->whereKey($validated['project_id'])
            ->update(['client_id' => $client->id, 'client' => $client->name]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Drawing assigned.')]);

        return back();
    }

    /**
     * Take a drawing off this client.
     */
    public function unassign(Request $request, Client $client, Project $project): RedirectResponse
    {
        Gate::authorize('update', $client);

        if ($project->client_id === $client->id && $request->user()->can('update', $project)) {
            $project->forceFill(['client_id' => null, 'client' => null])->save();
        }

        return back();
    }

    /**
     * @return array<string, mixed>
     */
    private function projectRow(Project $project): array
    {
        return [
            'id' => $project->id,
            'name' => $project->name,
            'number' => $project->number,
            'address' => $project->address,
            'units' => $project->units,
            'worked_seconds' => $project->worked_seconds,
            'worked_at' => $project->worked_at?->toIso8601String(),
            'opened_at' => $project->opened_at?->toIso8601String(),
            'summary' => $project->documentSummary(),
            'preview' => $project->planPreview(),
            // Unassigned drawings have no client and so no conversation; the
            // relation is only eager loaded for the ones that do.
            'comments' => $project->relationLoaded('comments')
                ? $project->comments->map(fn (ClientComment $comment): array => [
                    'id' => $comment->id,
                    'body' => $comment->body,
                    'created_at' => $comment->created_at?->toIso8601String(),
                ])
                : [],
        ];
    }
}
