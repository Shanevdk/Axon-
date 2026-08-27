<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreNoteRequest extends FormRequest
{
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

            // A note may only be filed against a drawing the team can see.
            'project_id' => [
                'nullable',
                Rule::exists('projects', 'id')->whereIn('user_id', $this->user()->teamMemberIds()),
            ],
        ];
    }
}
