<?php

namespace App\Http\Controllers;

use App\Actions\Assistant\RunClaudeCode;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use RuntimeException;

class ClaudeAccountController extends Controller
{
    /**
     * Sign in with your own Claude account.
     *
     * The token comes from `claude setup-token` and stands for a
     * subscription, so every turn taken in the designer's terminal and the
     * editor's sidebar is drawn from the plan of the person who asked. One
     * per user; signing in again replaces the token rather than collecting
     * them.
     *
     * It is proved before it is kept. A sign-in that is not checked is just a
     * text box that accepts anything and fails later somewhere else, so this
     * spends one very short turn to find out now.
     */
    public function store(Request $request, RunClaudeCode $claude): RedirectResponse
    {
        $validated = $request->validate([
            'token' => ['required', 'string', 'min:20', 'max:400'],
        ]);

        $token = trim($validated['token']);

        try {
            $claude->verify($token);
        } catch (RuntimeException $refused) {
            throw ValidationException::withMessages([
                'token' => $refused->getMessage(),
            ]);
        }

        $request->user()->claudeAccount()->updateOrCreate([], [
            'token' => $token,
            'verified_at' => now(),
        ]);

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('Signed in to Claude. Turns now come out of your subscription.'),
        ]);

        return back();
    }

    /**
     * Sign out. The token is deleted with the row.
     */
    public function destroy(Request $request): RedirectResponse
    {
        $request->user()->claudeAccount()?->delete();

        Inertia::flash('toast', [
            'type' => 'success',
            'message' => __('Signed out of Claude.'),
        ]);

        return back();
    }
}
