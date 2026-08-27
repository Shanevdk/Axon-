<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\AskOpenRouter;
use App\Actions\Assistant\NamePlace;
use App\Http\Requests\AskAssistantRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use RuntimeException;

class AssistantController extends Controller
{
    /**
     * The assistant screen.
     *
     * The transcript lives in the browser, so nothing is loaded here beyond
     * what the page needs to explain itself.
     */
    public function index(): Response
    {
        return Inertia::render('assistant', [
            'configured' => filled(config('services.openrouter.key')),
        ]);
    }

    /**
     * Answer a question.
     *
     * Answered over plain JSON rather than an Inertia visit: the page keeps
     * the conversation in state and appends replies as they land.
     */
    public function reply(AskAssistantRequest $request, AskOpenRouter $ask): JsonResponse
    {
        try {
            $reply = $ask->handle($request->transcript());
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        return response()->json(['reply' => $reply]);
    }

    /**
     * Name the place at a pair of coordinates.
     *
     * The editor's code consultant needs a jurisdiction, and this is what
     * "use my location" calls so nobody has to type one. The browser holds
     * the permission prompt; only coordinates reach here, and only a place
     * name goes back.
     */
    public function place(Request $request, NamePlace $name): JsonResponse
    {
        $validated = $request->validate([
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
        ]);

        try {
            $place = $name->handle(
                (float) $validated['latitude'],
                (float) $validated['longitude'],
            );
        } catch (RuntimeException $failure) {
            return response()->json(['message' => $failure->getMessage()], 503);
        }

        return response()->json(['place' => $place]);
    }
}
