<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Remembers that someone has been here before.
 *
 * A first sign-in lands on the front page, which is where Vanhaven explains
 * itself; every sign-in after that goes straight to the studio. Null means
 * they have never arrived, so existing accounts get the introduction once.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('signed_in_at')->nullable()->after('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('signed_in_at');
        });
    }
};
