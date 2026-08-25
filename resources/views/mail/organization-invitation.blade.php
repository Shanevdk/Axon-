<x-mail::message>
# You have been invited to {{ $organization }}

@if ($inviter)
{{ $inviter }} has invited you to join **{{ $organization }}** on {{ config('app.name') }}.
@else
You have been invited to join **{{ $organization }}** on {{ config('app.name') }}.
@endif

Everyone in the studio shares the same projects, clients and hours, and can talk
in one place. Accept below and you will see the team's work straight away.

<x-mail::button :url="$url">
Accept invitation
</x-mail::button>

This invitation expires on {{ $expiresAt->format('j F Y') }}. If you do not have
an account yet, you will be asked to create one first.

If you were not expecting this, you can ignore this email.

Thanks,<br>
{{ config('app.name') }}
</x-mail::message>
