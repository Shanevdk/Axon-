<?php

namespace App\Actions\Calendar;

use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;

/**
 * The shape of a month as a wall calendar draws it: whole weeks, Sunday to
 * Saturday, with the days either side of the month shown greyed rather than
 * left blank.
 *
 * Every date here is a plain `Y-m-d` string on the studio clock, which is what
 * a meeting's stored day is compared against.
 */
class BuildMonthGrid
{
    /**
     * The furthest the diary will page in either direction, so a crafted
     * `?month=` cannot walk the query somewhere absurd.
     */
    public const EARLIEST = '1970-01';

    public const LATEST = '2999-12';

    /**
     * @return array{
     *     value: string,
     *     label: string,
     *     previous: string,
     *     next: string,
     *     first: string,
     *     last: string,
     *     today: string,
     *     weeks: array<int, array<int, array{date: string, day: int, inMonth: bool, today: bool}>>
     * }
     */
    public function handle(?string $month = null): array
    {
        $first = $this->firstOfMonth($month);
        $today = Carbon::today()->format('Y-m-d');

        $cursor = $first->copy()->startOfWeek(CarbonInterface::SUNDAY);
        $last = $first->copy()->endOfMonth()->endOfWeek(CarbonInterface::SATURDAY);

        $weeks = [];

        while ($cursor <= $last) {
            $week = [];

            for ($day = 0; $day < 7; $day++) {
                $date = $cursor->format('Y-m-d');

                $week[] = [
                    'date' => $date,
                    'day' => $cursor->day,
                    'inMonth' => $cursor->month === $first->month,
                    'today' => $date === $today,
                ];

                $cursor->addDay();
            }

            $weeks[] = $week;
        }

        return [
            'value' => $first->format('Y-m'),
            'label' => $first->format('F Y'),
            'previous' => $first->copy()->subMonth()->format('Y-m'),
            'next' => $first->copy()->addMonth()->format('Y-m'),
            'first' => $weeks[0][0]['date'],
            'last' => $last->format('Y-m-d'),
            'today' => $today,
            'weeks' => $weeks,
        ];
    }

    /**
     * Read the requested month, falling back to this one when it is missing
     * or not a month at all.
     */
    private function firstOfMonth(?string $month): Carbon
    {
        if ($month === null
            || preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) !== 1
            || $month < self::EARLIEST
            || $month > self::LATEST) {
            return Carbon::today()->startOfMonth();
        }

        return Carbon::createFromFormat('Y-m-d', $month.'-01')->startOfDay();
    }
}
