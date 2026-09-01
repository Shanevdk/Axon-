<?php

use App\Concerns\AllowsTimeToAnswer;

/**
 * A stand-in for any action that waits on a borrowed service.
 */
function waiter(): object
{
    return new class
    {
        use AllowsTimeToAnswer;

        public function wait(int $seconds): int
        {
            return $this->allowSecondsToAnswer($seconds);
        }
    };
}

afterEach(function () {
    @set_time_limit(0);
});

test('a request is given longer than the wait it is about to make', function () {
    // Thirty seconds is PHP's default, and every service here waits longer.
    @set_time_limit(30);

    waiter()->wait(60);

    expect((int) ini_get('max_execution_time'))->toBeGreaterThan(60);
});

test('it hands back the timeout unchanged, so the caller still sets it', function () {
    expect(waiter()->wait(45))->toBe(45);
});

test('it leaves an unlimited request alone', function () {
    // Zero is the CLI and the queue: there is no limit to raise.
    @set_time_limit(0);

    waiter()->wait(120);

    expect((int) ini_get('max_execution_time'))->toBe(0);
});

test('it does not shorten a budget that is already generous', function () {
    @set_time_limit(300);

    waiter()->wait(60);

    expect((int) ini_get('max_execution_time'))->toBe(300);
});

/**
 * The bug this exists to stop: a service configured to wait longer than PHP
 * allows can never time out cleanly. PHP kills the process first, with a
 * fatal error, so the `catch` that turns a slow service into "try again in a
 * moment" never runs and the person sees a dead request instead.
 */
test('no service is configured to wait longer than a request may run', function (string $service) {
    $timeout = (int) config("services.{$service}.timeout");

    @set_time_limit(30);

    waiter()->wait($timeout);

    expect((int) ini_get('max_execution_time'))
        ->toBeGreaterThan($timeout, "services.{$service}.timeout outlives its request");
})->with([
    'openrouter',
    'pollinations',
    'claude_code',
    'anthropic',
    'openai',
    'ground',
    'places',
]);
