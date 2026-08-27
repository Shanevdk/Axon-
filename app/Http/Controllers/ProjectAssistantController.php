<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\AskAboutTheBuilding;
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
