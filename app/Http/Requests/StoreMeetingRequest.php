<?php

namespace App\Http\Requests;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreMeetingRequest extends FormRequest
{
    use BooksAMeeting;

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return $this->bookingRules(
            Rule::exists('clients', 'id')->whereIn('user_id', $this->user()->teamMemberIds()),
            Rule::exists('projects', 'id')->whereIn('user_id', $this->user()->teamMemberIds()),
        );
    }
}
