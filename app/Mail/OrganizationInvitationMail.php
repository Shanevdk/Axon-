<?php

namespace App\Mail;

use App\Models\OrganizationInvitation;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class OrganizationInvitationMail extends Mailable
{
    use Queueable, SerializesModels;

    /**
     * Create a new message instance.
     */
    public function __construct(public OrganizationInvitation $invitation) {}

    /**
     * Get the message envelope.
     */
    public function envelope(): Envelope
    {
        $inviter = $this->invitation->inviter?->name;
        $organization = $this->invitation->organization->name;

        return new Envelope(
            subject: $inviter === null
                ? __('You have been invited to :organization', ['organization' => $organization])
                : __(':inviter invited you to :organization', [
                    'inviter' => $inviter,
                    'organization' => $organization,
                ]),
        );
    }

    /**
     * Get the message content definition.
     */
    public function content(): Content
    {
        return new Content(
            markdown: 'mail.organization-invitation',
            with: [
                'organization' => $this->invitation->organization->name,
                'inviter' => $this->invitation->inviter?->name,
                'url' => $this->invitation->url(),
                'expiresAt' => $this->invitation->expiresAt(),
            ],
        );
    }
}
