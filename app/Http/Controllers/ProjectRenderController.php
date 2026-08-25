<?php

namespace App\Http\Controllers;

use App\Actions\Projects\RenderDesignImage;
use App\Http\Requests\RenderDesignRequest;
use App\Models\Project;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Gate;
use RuntimeException;

class ProjectRenderController extends Controller
{
    /**
     * Photograph the design.
     *
     * The prompt is built in the editor from the live document — including
     * unsaved work — so nothing is read back off the project here beyond the
     * authorization check.
     */
    public function store(
        RenderDesignRequest $request,
        Project $project,
        RenderDesignImage $render,
    ): JsonResponse {
        Gate::authorize('view', $project);

        try {
            $image = $render->handle(
                $request->string('prompt')->toString(),
                $request->integer('width'),
                $request->integer('height'),
                $request->integer('seed'),
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        return response()->json(['image' => $image]);
    }
}
