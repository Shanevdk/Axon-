<?php

namespace App\Http\Requests;

use App\Actions\Site\FetchGroundLevels;
use Illuminate\Foundation\Http\FormRequest;

class SurveyGroundRequest extends FormRequest
{
    /** The project policy has already been checked by the controller. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'latitude' => ['required', 'numeric', 'between:-90,90'],
            'longitude' => ['required', 'numeric', 'between:-180,180'],
            'span' => [
                'required',
                'integer',
                'min:'.FetchGroundLevels::MIN_SPAN,
                'max:'.FetchGroundLevels::MAX_SPAN,
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'span.min' => 'A property smaller than :min metres across is finer than the ground data.',
            'span.max' => 'Measure at most :max metres across at a time.',
        ];
    }
}
