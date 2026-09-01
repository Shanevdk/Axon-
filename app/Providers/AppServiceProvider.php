<?php

namespace App\Providers;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;
use Laravel\Passport\Passport;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();
        $this->configureTheConnector();
    }

    /**
     * Vanhaven as something Claude can be connected to.
     *
     * Adding the connector sends a person here to approve it. That screen is
     * the only part of the OAuth flow they ever see, so it is the studio's
     * own rather than a stock consent page — see resources/views/mcp.
     *
     * Tokens are deliberately short-lived and refreshable: a connector left
     * on a machine somebody no longer has should stop working by itself.
     */
    protected function configureTheConnector(): void
    {
        Passport::authorizationView(
            fn (array $parameters) => view('mcp.authorize', $parameters),
        );

        Passport::tokensExpireIn(now()->addDays(15));
        Passport::refreshTokensExpireIn(now()->addDays(30));
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
