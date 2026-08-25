<?php

use App\Models\Client;
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
        Schema::table('projects', function (Blueprint $table) {
            $table->foreignIdFor(Client::class)
                ->nullable()
                ->after('user_id')
                ->constrained()
                ->nullOnDelete();

            // Accumulated active editing time, measured from save activity.
            $table->unsignedBigInteger('worked_seconds')->default(0)->after('opened_at');
            $table->timestamp('worked_at')->nullable()->after('worked_seconds');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropConstrainedForeignIdFor(Client::class);
            $table->dropColumn(['worked_seconds', 'worked_at']);
        });
    }
};
