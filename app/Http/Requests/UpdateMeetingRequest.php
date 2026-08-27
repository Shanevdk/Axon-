<?php

namespace App\Http\Requests;

use App\Models\Meeting;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateMeetingRequest extends FormRequest
{
    use BooksAMeeting;

    /**
     * Determine if the user is authorized to make this request.
     */
    public function authorize(): bool
    {
        $meeting = $this->route('meeting');

        return $meeting instanceof Meeting && $this->user()->can('update', $meeting);
    }

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
