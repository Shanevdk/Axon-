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
     * The live parts board the item designer shares with Claude Code.
     *
     * This is what lets somebody use their Claude subscription instead of
     * API credit: Claude Code already runs on their own plan, so it reads
     * and writes this row over MCP while the browser watches. One board per
     * person — the one they are sitting at.
     */
    public function up(): void
    {
        Schema::create('design_boards', function (Blueprint $table) {
            $table->id();
            $table->foreignIdFor(User::class)->unique()->constrained()->cascadeOnDelete();
            $table->json('parts');
            $table->string('name')->nullable();
            $table->string('category')->nullable();

            // Bumped on every write so the browser can tell a change it made
            // from one Claude Code made.
            $table->unsignedBigInteger('revision')->default(0);
            $table->string('source')->default('browser');

            /** What Claude Code last said about the board. */
            $table->text('note')->nullable();

            /** What the person at the browser last asked for, unread. */
            $table->text('message')->nullable();

            $table->timestamp('opened_at')->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('design_boards');
    }
};
