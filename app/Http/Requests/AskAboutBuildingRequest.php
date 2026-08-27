<?php

namespace App\Http\Requests;

use App\Actions\Assistant\AskAboutTheBuilding;
use App\Actions\Assistant\AskOpenRouter;
use App\Models\Project;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class AskAboutBuildingRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $project = $this->route('project');

        return $project instanceof Project && $this->user()->can('view', $project);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * The survey is measured in the browser against the live document —
     * including work that has not been saved — so it arrives as free text and
     * is only bounded here, the same way a render prompt is.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'messages' => ['required', 'array', 'min:1', 'max:60'],
            'messages.*.role' => ['required', 'string', 'in:user,assistant'],
            'messages.*.content' => ['required', 'string', 'max:6000'],
            'survey' => ['nullable', 'string', 'max:'.AskAboutTheBuilding::SURVEY_LIMIT],
            'jurisdiction' => ['nullable', 'string', 'max:160'],
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
