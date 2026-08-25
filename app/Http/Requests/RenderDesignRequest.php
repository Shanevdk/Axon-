<?php

namespace App\Http\Requests;

use App\Actions\Projects\RenderDesignImage;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;

class RenderDesignRequest extends FormRequest
{
    /**
     * The frame sizes the dialog offers, guarded here so a crafted request
     * cannot ask the generator for a poster.
     */
    private const MAX_EDGE = 1536;

    /**
     * Get the validation rules that apply to the request.
     *
     * The prompt is composed in the browser from the model and may then be
     * edited by hand, so it arrives as free text and is only bounded here.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'prompt' => ['required', 'string', 'min:10', 'max:'.RenderDesignImage::PROMPT_LIMIT],
            'width' => ['required', 'integer', 'min:256', 'max:'.self::MAX_EDGE],
            'height' => ['required', 'integer', 'min:256', 'max:'.self::MAX_EDGE],
            'seed' => ['required', 'integer', 'min:0', 'max:999999'],
        ];
    }
}
