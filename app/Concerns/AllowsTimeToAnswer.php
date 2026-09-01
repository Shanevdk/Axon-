<?php

namespace App\Concerns;

/**
 * Room to wait for a slow service.
 *
 * PHP gives a web request 30 seconds by default. Every borrowed service in
 * this application is configured to wait longer than that — a reasoning model
 * thinks for half a minute, an image takes two, Claude Code takes three — so
 * without this the request is killed part way through the call.
 *
 * The damage is not the wait, it is what the wait turns into. A process
 * killed at the limit dies with a fatal error, which means the timeout the
 * caller carefully configured never fires, the `catch` never runs, and the
 * person gets "could not be reached" instead of "the model is busy, try
 * again". The budget has to be larger than the timeout for the timeout to be
 * the thing that happens.
 */
trait AllowsTimeToAnswer
{
    /**
     * Enough time to build the request and read the answer back, on top of
     * the wait itself.
     */
    private const HEADROOM = 20;

    /**
     * Let this request wait `$seconds` for an answer.
     *
     * Silent when the limit cannot be changed — some hosts forbid it, and a
     * slow answer is still worth trying for.
     */
    protected function allowSecondsToAnswer(int $seconds): int
    {
        $current = (int) ini_get('max_execution_time');

        // Zero means no limit, which is the CLI and the queue. Nothing to do.
        if ($current !== 0 && $current < $seconds + self::HEADROOM) {
            @set_time_limit($seconds + self::HEADROOM);
        }

        return $seconds;
    }
}
