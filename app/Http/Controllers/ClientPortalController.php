<?php

namespace App\Http\Controllers;

use App\Http\Middleware\EnsureClientSignedIn;
use App\Models\Client;
use App\Models\ClientComment;
use App\Models\Project;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The client's window onto their own house.
 *
 * Read-only by construction: this controller exposes progress and takes
 * comments, and there is no route from here to the editor or to anything
 * that writes a drawing.
 */
class ClientPortalController extends Controller
{
    /**
     * The number pad.
     */
    public function enter(Request $request): Response|RedirectResponse
    {
        if ($request->session()->has(EnsureClientSignedIn::SESSION_KEY)) {
            return redirect()->route('portal.show');
        }

        return Inertia::render('portal/enter');
    }

    /**
     * Exchange a number for a session.
     */
    public function open(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'number' => ['required', 'string', 'max:40'],
        ]);

        $client = Client::findByPortalNumber($validated['number']);

        if ($client === null) {
            // Nothing here says whether the number exists, only that this one
            // did not work.
            throw ValidationException::withMessages([
                'number' => __('That number is not one we recognise. Check it with your architect.'),
            ]);
        }

        // A fresh session id, so a number typed on a shared machine cannot be
        // ridden by whatever session was open before it.
        $request->session()->regenerate();
        $request->session()->put(EnsureClientSignedIn::SESSION_KEY, $client->id);

        return redirect()->route('portal.show');
    }

    /**
     * Progress on the client's drawings.
     */
    public function show(Request $request): Response
    {
        $client = $this->client($request);

        $client->recordPortalVisit();

        $projects = $client->projects()
            ->with(['comments' => fn ($query) => $query->latest('id')])
            ->latest('worked_at')
            ->latest('id')
            ->get();

        return Inertia::render('portal/show', [
            'client' => [
                'name' => $client->name,
                'username' => $client->portal_username,
            ],
            'drawings' => $projects->map(fn (Project $project): array => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
                'address' => $project->address,
                'units' => $project->units,
                'worked_seconds' => $project->worked_seconds,
                'worked_at' => $project->worked_at?->toIso8601String(),
                'summary' => $project->documentSummary(),
                'preview' => $project->planPreview(),
                'comments' => $project->comments->map(fn (ClientComment $comment): array => [
                    'id' => $comment->id,
                    'body' => $comment->body,
                    'created_at' => $comment->created_at?->toIso8601String(),
                ]),
            ]),
            'total_seconds' => $projects->sum('worked_seconds'),
        ]);
    }

    /**
     * The house in three dimensions, to look round and to walk through.
     */
    public function tour(Request $request, Project $project): Response
    {
        $client = $this->client($request);

        // Not 403: a client has no business learning that a drawing they
        // cannot see exists at all.
        abort_unless($project->client_id === $client->id, 404);

        return Inertia::render('portal/tour', [
            'drawing' => [
                'id' => $project->id,
                'name' => $project->name,
                'address' => $project->address,
                'units' => $project->units,
            ],
            'model' => $project->houseModel(),
            // A drawing last saved before the portal existed left only one
            // level on the server, and the client is told so rather than
            // being shown a bungalow that is really a two-storey house.
            'whole_building' => $project->houseModelIsWholeBuilding(),
        ]);
    }

    /**
     * Say something about a drawing.
     */
    public function comment(Request $request): RedirectResponse
    {
        $client = $this->client($request);

        $validated = $request->validate([
            // Scoped to this client's own drawings, so a crafted id cannot
            // put a comment on somebody else's house.
            'project_id' => ['required', 'integer', Rule::exists('projects', 'id')->where('client_id', $client->id)],
            'body' => ['required', 'string', 'max:2000'],
        ]);

        // Both keys are set rather than filled: which client and which
        // drawing a comment lands on is decided here, never by the request.
        (new ClientComment(['body' => $validated['body']]))
            ->forceFill(['client_id' => $client->id, 'project_id' => $validated['project_id']])
            ->save();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Comment sent to your architect.')]);

        return back();
    }

    /**
     * Close the portal session.
     */
    public function leave(Request $request): RedirectResponse
    {
        $request->session()->forget(EnsureClientSignedIn::SESSION_KEY);
        $request->session()->regenerate();

        return redirect()->route('portal.enter');
    }

    /**
     * The client this session belongs to, put there by the portal middleware.
     */
    private function client(Request $request): Client
    {
        /** @var Client */
        return $request->attributes->get(EnsureClientSignedIn::REQUEST_KEY);
    }
}
