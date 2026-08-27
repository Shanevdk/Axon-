<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class MessageController extends Controller
{
    /**
     * Post a message: to the team channel, or straight to one colleague
     * when a recipient rides along.
     */
    public function store(Request $request): RedirectResponse
    {
        $user = $request->user();

        abort_if($user->organization_id === null, 403, 'Join an organization to use the team chat.');

        $validated = $request->validate([
            'body' => ['required', 'string', 'max:2000'],
            'recipient_id' => ['nullable', 'integer'],
        ]);

        $recipientId = $validated['recipient_id'] ?? null;

        if ($recipientId !== null) {
            $recipient = User::query()->find($recipientId);

            // A private word only travels inside the studio, and never to
            // yourself — anything else reads as the team channel would.
            abort_if(
                $recipient === null
                    || $recipient->organization_id !== $user->organization_id
                    || $recipient->id === $user->id,
                403,
                'Direct messages only go to colleagues in your organization.',
            );
        }

        $user->organization->messages()->create([
            'body' => $validated['body'],
            'user_id' => $user->id,
            'recipient_id' => $recipientId,
        ]);

        return back();
    }
}
