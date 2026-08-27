<?php

namespace App\Http\Requests;

use App\Models\LibraryItem;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class SaveLibraryItemRequest extends FormRequest
{
    /**
     * Get the validation rules that apply to the request.
     *
     * The geometry was built in the browser — parsed from a file or compiled
     * from parts — so it arrives whole and is bounded here rather than
     * rebuilt. The vertex list is validated by shape and size, not element
     * by element: a hundred-thousand-entry array through per-item rules
     * would cost more than the save.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'category' => ['required', 'string', 'max:60'],
            'kind' => ['required', Rule::in(['imported', 'designed'])],
            'thumbnail' => ['required', 'string', 'max:400000', 'starts_with:data:image/svg+xml'],
            'payload' => ['required', 'array'],
            'payload.vertices' => ['required', 'array'],
            'payload.footprint' => ['required', 'array', 'min:3'],
            'payload.size' => ['required', 'array'],
            'payload.size.x' => ['required', 'numeric', 'min:1'],
            'payload.size.y' => ['required', 'numeric', 'min:1'],
            'payload.size.z' => ['required', 'numeric', 'min:0'],
            'payload.triangleCount' => ['required', 'integer', 'min:1', 'max:'.LibraryItem::MAX_TRIANGLES],
            'payload.parts' => ['sometimes', 'array', 'max:100'],
        ];
    }

    /**
     * The cheap structural checks per-item rules would make expensive.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $vertices = $this->input('payload.vertices');

            if (! is_array($vertices)) {
                return;
            }

            $count = count($vertices);

            if ($count === 0 || $count % 9 !== 0) {
                $validator->errors()->add('payload.vertices', 'The mesh must be whole triangles.');

                return;
            }

            if ($count / 9 > LibraryItem::MAX_TRIANGLES) {
                $validator->errors()->add(
                    'payload.vertices',
                    'The mesh is too heavy for the library — 20,000 triangles is the ceiling.',
                );

                return;
            }

            if ((int) $this->input('payload.triangleCount') !== $count / 9) {
                $validator->errors()->add('payload.triangleCount', 'The triangle count does not match the mesh.');
            }

            // Spot checks; a full sweep of a big mesh is not worth the time.
            foreach ([0, intdiv($count, 2), $count - 1] as $index) {
                if (! is_numeric($vertices[$index])) {
                    $validator->errors()->add('payload.vertices', 'The mesh contains something that is not a number.');

                    return;
                }
            }
        });
    }

    /**
     * The attributes as the model stores them.
     *
     * @return array<string, mixed>
     */
    public function item(): array
    {
        $validated = $this->validated();

        return [
            'name' => $validated['name'],
            'category' => $validated['category'],
            'kind' => $validated['kind'],
            'thumbnail' => $validated['thumbnail'],
            // The validated copy, so a crafted payload cannot smuggle keys.
            'payload' => $validated['payload'],
            'triangles' => (int) $validated['payload']['triangleCount'],
        ];
    }
}
