<?php

namespace App\Http\Controllers;

use App\Actions\Site\FetchGroundLevels;
use App\Actions\Site\FindPlaces;
use App\Http\Requests\SurveyGroundRequest;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use RuntimeException;

class ProjectSiteController extends Controller
{
    /**
     * Look up an address, for the map picker to drop a pin on.
     *
     * Not scoped to a project: the picker is used to site a building that
     * does not exist yet, from the new project dialog.
     */
    public function places(Request $request, FindPlaces $places): JsonResponse
    {
        $validated = $request->validate([
            'q' => ['required', 'string', 'max:200'],
        ]);

        return response()->json([
            'places' => $places->handle($validated['q']),
        ]);
    }

    /**
     * Measure the ground over this property.
     *
     * The levels are handed back rather than written to the project: the
     * drawing lives on the machine that made it, so the editor is the only
     * thing that may put a site into a document. This endpoint is a lookup
     * with a cache in front of it, nothing more.
     */
    public function ground(
        SurveyGroundRequest $request,
        Project $project,
        FetchGroundLevels $levels,
    ): JsonResponse {
        Gate::authorize('update', $project);

        try {
            $site = $levels->handle(
                (float) $request->validated('latitude'),
                (float) $request->validated('longitude'),
                (int) $request->validated('span'),
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        return response()->json(['site' => $site]);
    }
}
