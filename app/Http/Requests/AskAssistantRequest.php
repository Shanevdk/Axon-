<?php

namespace App\Http\Requests;

use App\Actions\Assistant\AskOpenRouter;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class AskAssistantRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * The browser owns the transcript and posts it back each time, so the
     * whole conversation is validated rather than a single message.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'messages' => ['required', 'array', 'min:1', 'max:60'],
            'messages.*.role' => ['required', 'string', 'in:user,assistant'],
            'messages.*.content' => ['required', 'string', 'max:6000'],
        ];
    }

    /**
     * The transcript, clipped to the tail the model will actually be sent.
     *
     * @return list<array{role: string, content: string}>
     */
    public function transcript(): array
    {
        /** @var list<array{role: string, content: string}> $messages */
        $messages = array_map(
            fn (array $message): array => [
                'role' => $message['role'],
                'content' => $message['content'],
            ],
            $this->validated('messages'),
        );

        return array_slice($messages, -AskOpenRouter::HISTORY_LIMIT);
    }
}
