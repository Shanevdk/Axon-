<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Translation\PotentiallyTranslatedString;

/**
 * An address at the practice.
 *
 * Vanhaven accounts belong to Van Haven, so the studio's own domains are the only
 * ones that may sign in — an allowlist rather than a blocklist, because the
 * question is "is this us?" and not "is this a free mailbox?".
 */
class WorkEmail implements ValidationRule
{
    /**
     * An address as it should be compared and stored.
     *
     * `trim()` is not enough. A terminal or a paste can smuggle in a
     * no-break space, a zero-width space or a stray escape, none of which
     * trim knows about — and an invisible character on the end of a domain
     * is a maddening way to be told your own address is not your own. An
     * address never legitimately contains whitespace, so all of it goes.
     */
    public static function normalise(?string $email): string
    {
        // \s is ordinary whitespace; \p{C} is every invisible control and
        // format character, the BOM and zero-width joiners among them.
        $clean = preg_replace('/[\s\p{C}]+/u', '', (string) $email) ?? '';

        return mb_strtolower($clean);
    }

    /**
     * Whether an address would be accepted. Useful anywhere a rule object is
     * the wrong shape — middleware, a console command, a report.
     */
    public static function passes(?string $email): bool
    {
        if (! config('workmail.enabled')) {
            return true;
        }

        $address = self::normalise($email);

        if ($address === '' || ! str_contains($address, '@')) {
            // Not an address at all; the `email` rule says so more usefully.
            return true;
        }

        if (in_array($address, (array) config('workmail.allowed', []), true)) {
            return true;
        }

        $domain = substr(strrchr($address, '@') ?: '', 1);

        foreach ((array) config('workmail.domains', []) as $allowed) {
            $allowed = mb_strtolower($allowed);

            // The domain itself, or anything beneath it.
            if ($domain === $allowed || str_ends_with($domain, '.'.$allowed)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The domains a person could sign in with, for saying so out loud.
     *
     * @return array<int, string>
     */
    public static function domains(): array
    {
        return array_map(
            fn (string $domain): string => '@'.$domain,
            (array) config('workmail.domains', []),
        );
    }

    /**
     * Run the validation rule.
     *
     * @param  Closure(string, ?string=): PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || self::passes($value)) {
            return;
        }

        $fail(__('Use your :domain address.', [
            'domain' => implode(' or ', self::domains()),
        ]));
    }
}
