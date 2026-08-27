<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One of the user's own AI accounts, connected to the item designer.
 *
 * The key never leaves the server once it arrives: encrypted at rest,
 * hidden from serialization, and only ever read to sign an outbound
 * request to its provider.
 *
 * @property int $id
 * @property int $user_id
 * @property string $provider
 * @property string $key
 * @property string|null $model
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['provider', 'key', 'model'])]
#[Hidden(['key'])]
class AiConnection extends Model
{
    /**
     * The providers the designer knows how to speak to, with the model each
     * uses when the connection does not name one.
     *
     * @var array<string, array{label: string, model: string}>
     */
    public const PROVIDERS = [
        'anthropic' => ['label' => 'Claude', 'model' => 'claude-sonnet-5'],
        'openai' => ['label' => 'OpenAI', 'model' => 'gpt-5-mini'],
        'openrouter' => ['label' => 'OpenRouter', 'model' => 'nvidia/nemotron-3-super-120b-a12b:free'],
    ];

    /**
     * The model requests are made with.
     */
    public function modelId(): string
    {
        return $this->model ?: self::PROVIDERS[$this->provider]['model'];
    }

    /**
     * Whose account this is.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'key' => 'encrypted',
        ];
    }
}
