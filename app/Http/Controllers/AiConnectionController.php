<?php

namespace App\Http\Controllers;

use App\Models\AiConnection;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;

class AiConnectionController extends Controller
{
    /**
     * Connect an AI account, or rekey one already connected.
     *
     * One connection per provider per user: saving Claude twice replaces
     * the key rather than collecting them.
     */
    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'provider' => ['required', Rule::in(array_keys(AiConnection::PROVIDERS))],
            'key' => ['required', 'string', 'max:400'],
            'model' => ['nullable', 'string', 'max:120'],
        ]);

        $request->user()->aiConnections()->updateOrCreate(
            ['provider' => $validated['provider']],
            ['key' => trim($validated['key']), 'model' => ($validated['model'] ?? null) ?: null],
        );

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __(':provider connected.', [
                'provider' => AiConnection::PROVIDERS[$validated['provider']]['label'],
            ]),
        ]);

        return back();
    }

    /**
     * Disconnect an account. The key is deleted with it.
     */
    public function destroy(Request $request, AiConnection $aiConnection): RedirectResponse
    {
        abort_unless($aiConnection->user_id === $request->user()->id, 403);

        $aiConnection->delete();

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Disconnected.')]);

        return back();
    }
}
