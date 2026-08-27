<?php

use App\Models\User;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            // Null means the team channel; set means a direct message.
            $table->foreignIdFor(User::class, 'recipient_id')
                ->nullable()
                ->constrained('users')
                ->cascadeOnDelete();
            // When the recipient opened the conversation it arrived in.
            $table->timestamp('read_at')->nullable();

            $table->index(['recipient_id', 'read_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('messages', function (Blueprint $table) {
            $table->dropConstrainedForeignIdFor(User::class, 'recipient_id');
            $table->dropColumn('read_at');
        });
    }
};
