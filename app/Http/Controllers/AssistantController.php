<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\AskOpenRouter;
use App\Http\Requests\AskAssistantRequest;
use Illuminate\Http\JsonResponse;
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
}
