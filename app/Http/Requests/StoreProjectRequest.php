<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreProjectRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'number' => ['nullable', 'string', 'max:40'],
            'client' => ['nullable', 'string', 'max:120'],
            'address' => ['nullable', 'string', 'max:200'],
            'jurisdiction' => ['nullable', 'string', 'max:160'],
            // Picked on the map rather than typed, and they arrive together
            // or not at all — half a coordinate is not a place.
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'units' => ['required', Rule::in(['metric', 'imperial'])],
            'template' => ['required', Rule::in(['blank', 'residence'])],
        ];
    }
}
