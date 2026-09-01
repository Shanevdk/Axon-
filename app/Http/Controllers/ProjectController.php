<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\RunClaudeCode;
use App\Actions\Projects\BuildStarterDocument;
use App\Http\Requests\StoreProjectRequest;
use App\Http\Requests\UpdateProjectRequest;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use Inertia\Response;

class ProjectController extends Controller
{
    /**
     * List the projects belonging to the current user.
     */
    public function index(Request $request): Response
    {
        $projects = $request->user()
            ->teamProjects()
            ->latest('opened_at')
            ->latest('id')
            ->get()
            ->map(fn (Project $project): array => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
                'client' => $project->client,
                'address' => $project->address,
                'units' => $project->units,
                'opened_at' => $project->opened_at?->toIso8601String(),
                'updated_at' => $project->updated_at?->toIso8601String(),
                'summary' => $project->documentSummary(),
                'preview' => $project->planPreview(),
            ]);

        return Inertia::render('projects/index', [
            'projects' => $projects,
        ]);
    }

    /**
     * Create a new project seeded with a starter model document.
     */
    public function store(StoreProjectRequest $request, BuildStarterDocument $starter): RedirectResponse
    {
        $units = $request->validated('units');

        $project = $request->user()->projects()->create([
            ...$request->safe()->except('template'),
            'document' => $request->validated('template') === 'residence'
                ? $starter->sampleResidence($units)
                : $starter->empty($units),
        ]);

        return to_route('projects.show', $project);
    }

    /**
     * Open a project in the modelling environment.
     */
    public function show(Request $request, Project $project, BuildStarterDocument $starter): Response
    {
        Gate::authorize('view', $project);

        $project->forceFill(['opened_at' => now()])->saveQuietly();
        $project->recordWork();

        return Inertia::render('projects/editor', [
            'project' => [
                'id' => $project->id,
                'name' => $project->name,
                'number' => $project->number,
                'client' => $project->client,
                'address' => $project->address,
                'jurisdiction' => $project->jurisdiction,
                // Where the site picker put the pin, so the ground levels
                // dialog opens on the building rather than on the equator.
                'latitude' => $project->latitude,
                'longitude' => $project->longitude,
                'units' => $project->units,
                'updated_at' => $project->updated_at?->toIso8601String(),
            ],
            // Only worth sending while it is still the whole model. Once the
            // drawing lives on a machine this is a one-level preview, and the
            // editor loads the real thing out of its local vault instead.
            'document' => $project->has_local_model
                ? null
                : $starter->normalize($project->document),
            'hasLocalModel' => $project->has_local_model,
            // The editor's code consultant is hidden rather than broken when
            // there is no key to reach the model with.
            'assistantReady' => filled(config('services.openrouter.key')),
            // Whether the sidebar can take a turn, split into the two things
            // that have to be true: the CLI is on this machine, and this
            // person has signed in with their own Claude account. The dock
            // asks for whichever is missing rather than failing on the first
            // question.
            'claude' => [
                'installed' => app(RunClaudeCode::class)->isAvailable(),
                'signedIn' => $request->user()?->claudeAccount !== null,
            ],
        ]);
    }

    /**
     * Update the project's identifying information.
     */
    public function update(UpdateProjectRequest $request, Project $project): RedirectResponse
    {
        $project->update($request->validated());

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Project information updated.')]);

        return back();
    }

    /**
     * Persist the model document.
     *
     * The editor saves continuously while the user draws, so this responds
     * with JSON rather than an Inertia redirect to avoid re-rendering the
     * page and discarding in-flight canvas state.
     */
    public function updateDocument(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('update', $project);

        $validated = $request->validate([
            'document' => ['required', 'array'],
            'document.version' => ['required', 'integer'],
            'document.units' => ['required', 'in:metric,imperial'],
            'document.levels' => ['required', 'array'],
            'document.wallTypes' => ['required', 'array'],
            'document.doorTypes' => ['present', 'array'],
            'document.windowTypes' => ['present', 'array'],
            'document.elements' => ['present', 'array'],
            // A summary means the document above is only a preview and the
            // model itself is staying on the machine that drew it. Without
            // one, this is a whole document and is stored as it always was.
            // The house as the client portal shows it: every level, but only
            // what is built. Optional, because a drawing with nothing built
            // in it has no house to send.
            'client_model' => ['sometimes', 'nullable', 'array'],
            'client_model.version' => ['required_with:client_model', 'integer'],
            'client_model.units' => ['required_with:client_model', 'in:metric,imperial'],
            'client_model.levels' => ['required_with:client_model', 'array'],
            'client_model.wallTypes' => ['required_with:client_model', 'array'],
            'client_model.elements' => ['required_with:client_model', 'array'],
            'summary' => ['sometimes', 'array'],
            'summary.levels' => ['required_with:summary', 'integer', 'min:0'],
            'summary.walls' => ['required_with:summary', 'integer', 'min:0'],
            'summary.rooms' => ['required_with:summary', 'integer', 'min:0'],
            'summary.openings' => ['required_with:summary', 'integer', 'min:0'],
            'summary.wallLength' => ['required_with:summary', 'numeric', 'min:0'],
            'summary.slabArea' => ['required_with:summary', 'numeric', 'min:0'],
        ]);

        $isPreview = array_key_exists('summary', $validated);

        $project->forceFill([
            'document' => $validated['document'],
            'summary' => $isPreview ? $validated['summary'] : null,
            'has_local_model' => $isPreview,
            // Absent means the editor did not send one this time, which is not
            // the same as the house having been emptied — only an explicit
            // null clears it.
            ...array_key_exists('client_model', $validated)
                ? ['client_model' => $validated['client_model']]
                : [],
        ])->save();

        // Every save is evidence of active work, so the clock ticks here.
        $project->recordWork();

        return response()->json([
            'saved_at' => $project->updated_at?->toIso8601String(),
        ]);
    }

    /**
     * Delete a project.
     */
    public function destroy(Project $project): RedirectResponse
    {
        Gate::authorize('delete', $project);

        $project->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Project deleted.')]);

        return to_route('projects.index');
    }
}
