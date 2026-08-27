<?php

namespace App\Http\Requests;

use App\Models\Note;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateNoteRequest extends FormRequest
{
    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $note = $this->route('note');

        return $note instanceof Note && $this->user()->can('update', $note);
    }

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'title' => ['required', 'string', 'max:160'],
            'body' => ['nullable', 'string', 'max:20000'],
            'pinned' => ['boolean'],
            'project_id' => [
                'nullable',
                Rule::exists('projects', 'id')->whereIn('user_id', $this->user()->teamMemberIds()),
            ],
        ];
    }
}
