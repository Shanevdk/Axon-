<?php

namespace App\Actions\Assistant;

use RuntimeException;

/**
 * The assistant that sits inside the editor.
 *
 * It differs from the general one in two ways: it is handed a survey of the
 * drawing that is open, measured in the browser, and it is told where the
 * building is so it can name the code actually in force there rather than
 * defaulting to whichever one it has read the most of.
 *
 * It is a knowledgeable colleague, not an authority. The brief is written so
 * that it reasons from the drawing, says which code it is answering under,
 * and is candid about the difference between a rule it is sure of and one it
 * is recalling.
 */
class AskAboutTheBuilding
{
    /**
     * How much measured model may travel with a question.
     *
     * The survey grows with the drawing, and free models carry small context
     * windows, so it is clipped rather than allowed to crowd out the question.
     */
    public const SURVEY_LIMIT = 6000;

    /**
     * What to say when nobody has said where the building is.
     */
    private const NO_JURISDICTION = <<<'TEXT'
        Nobody has said where this building is. Answer in general terms, name
        the codes that could apply and how they differ, and open your reply by
        asking which city, province or state, and country it is in.
        TEXT;

    private const BRIEF = <<<'PROMPT'
        You are the code consultant built into Vanhaven, a browser-based
        architectural drafting and modelling application made by Van Haven. You
        are sitting with an architect at their drawing.

        You have two jobs. The first is to answer questions about the building
        they have drawn, reading the survey below rather than guessing. The
        second is to answer questions about the building code, the fire code
        and zoning that apply where the building is.

        How to answer code questions:
        - Name the code you are answering under, by title and edition, before
          you give the rule. If a province, state or city amends the national
          code, say so and answer under the amended version.
        - Give the requirement plainly, with the number that matters — the
          width, the rating, the distance, the count.
        - Cite the clause or article number only when you are confident of it.
          If you know the rule but not where it sits, give the rule and say you
          are not certain of the reference. Never invent a clause number.
        - Where the survey lets you check the drawing against the rule, do it,
          and say which elements pass and which do not.
        - Where a rule turns on something not in the drawing — occupancy
          classification, sprinklers, construction type, street frontage —
          say what you would need to know and ask for it.
        - Codes change and officials interpret them. End any answer that gives
          a requirement by saying it must be confirmed with the authority
          having jurisdiction. Say it once, briefly, not as a wall of caveats.

        Answer questions about the drawing itself directly from the survey. If
        the survey does not say, say that it does not say rather than
        estimating. Every length in the survey is stated in its unit.

        Be direct and concise. Plain prose; a short list only when the answer
        really is a list.
        PROMPT;

    public function __construct(private AskOpenRouter $openRouter) {}

    /**
     * Put a question, given what has been drawn and where it is.
     *
     * @param  list<array{role: string, content: string}>  $messages
     *
     * @throws RuntimeException when the assistant is unconfigured or upstream fails
     */
    public function handle(array $messages, string $survey, ?string $jurisdiction): string
    {
        return $this->openRouter->ask($this->brief($survey, $jurisdiction), $messages);
    }

    /**
     * Compose the standing brief with this drawing's particulars.
     */
    private function brief(string $survey, ?string $jurisdiction): string
    {
        $where = blank($jurisdiction)
            ? self::NO_JURISDICTION
            : "This building is in {$jurisdiction}. Answer under the building, fire "
                .'and zoning codes in force there, including any provincial, state '
                .'or municipal amendments. If you are not sure which edition that '
                .'place has adopted, say so and answer under the most recent one.';

        $measured = trim($survey) === ''
            ? 'Nothing has been drawn yet, so there is no survey. Say so if you are asked about the drawing.'
            : "Survey of the drawing that is open:\n".mb_substr(trim($survey), 0, self::SURVEY_LIMIT);

        return implode("\n\n", [self::BRIEF, $where, $measured]);
    }
}
