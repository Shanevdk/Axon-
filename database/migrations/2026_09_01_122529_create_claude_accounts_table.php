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
     * A person's own Claude sign-in, used by the item designer's terminal and
     * the editor's sidebar. This is deliberately not an `ai_connections` row:
     * that table holds API keys for providers the app POSTs JSON to, billed
     * per token. This is a subscription token from `claude setup-token`, and
     * the only thing that reads it is the Claude Code CLI.
     *
     * One per user, and personal — a token spends its owner's plan, so it is
     * never shared across a studio the way drawings are.
     */
    public function up(): void
    {
        Schema::create('claude_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignIdFor(User::class)->unique()->constrained()->cascadeOnDelete();
            $table->text('token');
            // When the token last proved it could actually answer, so the
            // sidebar can say more than "connected at some point".
            $table->timestamp('verified_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('claude_accounts');
    }
};
