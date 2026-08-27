<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * A user's own AI accounts — Claude, OpenAI, OpenRouter — connected so
     * the item designer can ask them for parts. The key is encrypted at
     * rest and is personal: connections are never shared across a team the
     * way drawings are, because an API key bills its owner.
     */
    public function up(): void
    {
        Schema::create('ai_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignIdFor(User::class)->constrained()->cascadeOnDelete();
            $table->string('provider'); // anthropic | openai | openrouter
            $table->text('key');
            $table->string('model')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'provider']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('ai_connections');
    }
};
