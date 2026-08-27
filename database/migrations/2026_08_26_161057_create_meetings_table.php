<?php

use App\Models\Client;
use App\Models\Project;
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
        Schema::create('meetings', function (Blueprint $table) {
            $table->id();
            $table->foreignIdFor(User::class)->constrained()->cascadeOnDelete();
            $table->foreignIdFor(Client::class)->nullable()->constrained()->nullOnDelete();
            $table->foreignIdFor(Project::class)->nullable()->constrained()->nullOnDelete();
            $table->string('title');

            // Studio wall-clock time, stored exactly as it was typed in. See
            // Meeting::$casts for why this is never shifted into a timezone.
            $table->dateTime('starts_at');
            $table->dateTime('ends_at')->nullable();

            $table->string('location')->nullable();
            $table->string('attendees')->nullable();
            $table->text('agenda')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'starts_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('meetings');
    }
};
