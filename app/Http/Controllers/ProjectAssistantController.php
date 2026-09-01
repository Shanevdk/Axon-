<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\AskAboutTheBuilding;
use App\Actions\Assistant\WorkTheDrawing;
use App\Http\Requests\AskAboutBuildingRequest;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Inertia\Inertia;
use RuntimeException;

class ProjectAssistantController extends Controller
{
    /**
     * Answer a question about this building.
     *
     * Like the render endpoint, nothing is read back off the project: the
     * survey is measured in the editor from the live document, which is the
     * only copy that includes work not yet saved.
     */
    public function reply(
        AskAboutBuildingRequest $request,
        Project $project,
        AskAboutTheBuilding $ask,
    ): JsonResponse {
        try {
            $reply = $ask->handle(
                $request->transcript(),
                $request->string('survey')->toString(),
                $request->string('jurisdiction')->toString() ?: $project->jurisdiction,
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        return response()->json(['reply' => $reply]);
    }

    /**
     * One turn with Claude in the editor's sidebar.
     *
     * Unlike the consultant above, this one is holding tools: the app's own
     * MCP server, so it can read the model and — when the sidebar is set to
     * Build — draw in it. Building sends the live drawing up with the
     * question, because that copy is the only current one, and gets whatever
     * changed back for the editor to commit as a single undo entry.
     */
    public function claude(
        Request $request,
        Project $project,
        WorkTheDrawing $work,
    ): JsonResponse {
        $validated = $request->validate([
            'prompt' => ['required', 'string', 'min:1', 'max:4000'],
            'mode' => ['required', 'in:ask,build'],
            'session' => ['nullable', 'string', 'max:100'],
            // Only a build turn hands the drawing over, and it must be the
            // whole one — a preview would be built on and then thrown away.
            'document' => ['required_if:mode,build', 'nullable', 'array'],
            'document.version' => ['required_with:document', 'integer'],
            'document.units' => ['required_with:document', 'in:metric,imperial'],
            'document.levels' => ['required_with:document', 'array', 'min:1'],
            // Present, not required: a drawing with nothing in it yet is the
            // most natural thing to ask Claude to start.
            'document.wallTypes' => ['present_with:document', 'array'],
            'document.elements' => ['present_with:document', 'array'],
        ]);

        Gate::authorize(
            $validated['mode'] === 'build' ? 'update' : 'view',
            $project,
        );

        $account = $request->user()->claudeAccount;

        if ($account === null) {
            return response()->json([
                'message' => __('Sign in with your Claude account to use the sidebar. A turn is drawn from your own subscription, so it has to be yours.'),
            ], 403);
        }

        try {
            $turn = $work->handle(
                $account,
                $project,
                $validated['prompt'],
                $validated['mode'],
                $validated['document'] ?? null,
                $validated['session'] ?? null,
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        // A turn that drew something is work on the project like any other.
        if ($turn['changes'] !== []) {
            $project->recordWork();
        }

        return response()->json($turn);
    }

    /**
     * Remember where this building is.
     *
     * Kept apart from the project information form so the assistant can ask
     * once and never have to ask again, without making somebody fill in a
     * whole dialog to answer one question.
     */
    public function updateJurisdiction(Request $request, Project $project): RedirectResponse
    {
        Gate::authorize('update', $project);

        $validated = $request->validate([
            'jurisdiction' => ['nullable', 'string', 'max:160'],
        ]);

        $project->update(['jurisdiction' => $validated['jurisdiction'] ?: null]);

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('Location saved for this project.'),
        ]);

        return back();
    }
}
