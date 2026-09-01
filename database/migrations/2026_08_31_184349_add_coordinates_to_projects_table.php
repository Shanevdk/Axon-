<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     *
     * Where the building actually stands, as picked on the map. Six decimal
     * places is about a tenth of a metre, which is finer than a geocoder can
     * honestly claim and coarse enough to make clear this is a spot on a
     * map rather than a surveyed corner.
     *
     * The document's `site` still carries its own coordinates: those are the
     * middle of a measured square of ground, which is not always where the
     * house goes. This is the project's address made into a point.
     */
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->decimal('latitude', 9, 6)->nullable()->after('address');
            $table->decimal('longitude', 9, 6)->nullable()->after('latitude');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn(['latitude', 'longitude']);
        });
    }
};
