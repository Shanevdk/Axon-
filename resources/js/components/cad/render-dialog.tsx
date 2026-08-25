import { useHttp } from '@inertiajs/react';
import { AlertTriangle, Camera, Download, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { CadEditor } from '@/hooks/use-cad-editor';
import {
    describeDesign,
    RENDER_ASPECTS,
    RENDER_STYLES,
    renderPrompt,
} from '@/lib/cad/brief';
import type { RenderAspect, RenderStyle } from '@/lib/cad/brief';
import { cn } from '@/lib/utils';
import { render as renderRoute } from '@/routes/projects';

type RenderDialogProps = {
    editor: CadEditor;
    projectId: number;
    projectName: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

/** Seeds are shown to nobody, but a fresh one is what makes Regenerate differ. */
function freshSeed(): number {
    return Math.floor(Math.random() * 1_000_000);
}

export function RenderDialog({
    editor,
    projectId,
    projectName,
    open,
    onOpenChange,
}: RenderDialogProps) {
    const [style, setStyle] = useState<RenderStyle>('golden');
    const [aspect, setAspect] = useState<RenderAspect>('wide');
    // Null means "follow the model"; typing pins an override that survives
    // until it is cleared, so the brief tracks edits without an effect.
    const [override, setOverride] = useState<string | null>(null);
    const [image, setImage] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);

    const brief = useMemo(
        () => describeDesign(editor.document),
        [editor.document],
    );

    const { post, transform, processing } = useHttp<
        { prompt: string; width: number; height: number; seed: number },
        { image: string }
    >({ prompt: '', width: 0, height: 0, seed: 0 });

    const prompt = override ?? brief.prompt;

    function run(seed: number) {
        const frame = RENDER_ASPECTS[aspect];
        const composed = renderPrompt(prompt, style);

        setFailure(null);
        transform(() => ({
            prompt: composed,
            width: frame.width,
            height: frame.height,
            seed,
        }));

        post(renderRoute.url({ project: projectId }), {
            onSuccess: (response) => {
                setImage(response.image);
                editor.setStatus('Render finished');
            },
            onHttpException: (response) => {
                const body = response.data as { message?: string } | null;

                setFailure(
                    body?.message ??
                        'The image generator could not be reached. Try again in a moment.',
                );

                return false;
            },
            onNetworkError: () => {
                setFailure('No connection to the image generator.');

                return false;
            },
            onError: () => {
                setFailure('That prompt could not be sent. Try shortening it.');
            },
        }).catch(() => {
            // Already reported through the callbacks above.
        });
    }

    function download() {
        if (!image) {
            return;
        }

        const link = window.document.createElement('a');

        link.href = image;
        link.download = `${projectName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-render.jpg`;
        link.click();
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Render the design</DialogTitle>
                    <DialogDescription>
                        The brief below is measured off the model as it stands.
                        Edit it if you want, then take the photograph.
                    </DialogDescription>
                </DialogHeader>

                {brief.empty ? (
                    <p className="rounded-md border border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
                        Nothing is drawn yet. Put up some walls and there will
                        be something to photograph.
                    </p>
                ) : (
                    <div className="space-y-5">
                        <section className="space-y-2">
                            <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                Read from the model
                            </Label>
                            <div className="flex flex-wrap gap-1.5">
                                {brief.facts.map((fact) => (
                                    <span
                                        key={fact}
                                        className="rounded-sm border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground"
                                    >
                                        {fact}
                                    </span>
                                ))}
                            </div>
                        </section>

                        <section className="space-y-2">
                            <Label
                                htmlFor="render-prompt"
                                className="text-xs tracking-wide text-muted-foreground uppercase"
                            >
                                Brief
                            </Label>
                            <textarea
                                id="render-prompt"
                                rows={3}
                                value={prompt}
                                onChange={(event) =>
                                    setOverride(event.target.value)
                                }
                                className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring"
                            />
                            {override !== null && (
                                <button
                                    type="button"
                                    onClick={() => setOverride(null)}
                                    className="text-[0.7rem] text-muted-foreground underline underline-offset-4 hover:text-foreground"
                                >
                                    Back to what the model says
                                </button>
                            )}
                        </section>

                        <div className="grid gap-5 sm:grid-cols-2">
                            <section className="space-y-2">
                                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                    Light
                                </Label>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {(
                                        Object.keys(
                                            RENDER_STYLES,
                                        ) as RenderStyle[]
                                    ).map((option) => (
                                        <Chip
                                            key={option}
                                            active={style === option}
                                            onClick={() => setStyle(option)}
                                        >
                                            {RENDER_STYLES[option].label}
                                        </Chip>
                                    ))}
                                </div>
                            </section>

                            <section className="space-y-2">
                                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                                    Frame
                                </Label>
                                <div className="grid gap-1.5">
                                    {(
                                        Object.keys(
                                            RENDER_ASPECTS,
                                        ) as RenderAspect[]
                                    ).map((option) => (
                                        <Chip
                                            key={option}
                                            active={aspect === option}
                                            onClick={() => setAspect(option)}
                                        >
                                            {RENDER_ASPECTS[option].label}
                                        </Chip>
                                    ))}
                                </div>
                            </section>
                        </div>

                        {(image || processing) && (
                            <section className="overflow-hidden rounded-md border border-border bg-muted/40">
                                {processing ? (
                                    <div className="flex h-56 animate-pulse items-center justify-center text-sm text-muted-foreground">
                                        Taking the photograph…
                                    </div>
                                ) : (
                                    image && (
                                        <img
                                            src={image}
                                            alt={`Render of ${projectName}`}
                                            className="w-full"
                                        />
                                    )
                                )}
                            </section>
                        )}

                        {failure && (
                            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                {failure}
                            </p>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 sm:justify-between">
                    <Button
                        variant="ghost"
                        onClick={download}
                        disabled={!image}
                        className="sm:mr-auto"
                    >
                        <Download className="size-4" />
                        Save image
                    </Button>

                    {image && (
                        <Button
                            variant="outline"
                            onClick={() => run(freshSeed())}
                            disabled={processing}
                        >
                            <Shuffle className="size-4" />
                            Again
                        </Button>
                    )}

                    <Button
                        onClick={() => run(freshSeed())}
                        disabled={
                            processing ||
                            brief.empty ||
                            prompt.trim().length < 10
                        }
                    >
                        <Camera className="size-4" />
                        {processing ? 'Rendering…' : 'Render'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Chip({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-sm border px-2 py-1.5 text-left text-[0.75rem] transition-colors',
                active
                    ? 'border-sand bg-accent text-foreground'
                    : 'border-border text-muted-foreground hover:border-sand/60',
            )}
        >
            {children}
        </button>
    );
}
