<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    /**
     * Post a message to the team conversation.
     */
    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();

        abort_if($user->organization_id === null, 403, 'Join an organization to use the team chat.');

        $validated = $request->validate([
            'body' => ['required', 'string', 'max:2000'],
        ]);

        $user->organization->messages()->create([
            ...$validated,
            'user_id' => $user->id,
        ]);

        return back();
    }
}
