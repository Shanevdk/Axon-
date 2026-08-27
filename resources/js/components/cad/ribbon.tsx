import { useState } from 'react';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { RIBBON_TABS } from '@/lib/cad/ribbon';
import type {
    RibbonAction,
    RibbonButton,
    RibbonTab,
    ToggleId,
} from '@/lib/cad/ribbon';
import type { FixtureCategory, ToolId } from '@/lib/cad/types';
import { cn } from '@/lib/utils';

type RibbonProps = {
    activeTool: ToolId;
    /** Which component category the fixture tool is armed with. */
    activeFixture: FixtureCategory;
    /** Present while something is selected; takes focus when it appears. */
    contextualTab: RibbonTab | null;
    isToggled: (setting: ToggleId) => boolean;
    isDisabled: (action: RibbonAction) => boolean;
    onAction: (action: RibbonAction) => void;
};

export function Ribbon({
    activeTool,
    activeFixture,
    contextualTab,
    isToggled,
    isDisabled,
    onAction,
}: RibbonProps) {
    const [permanentTab, setPermanentTab] = useState(RIBBON_TABS[0].id);
    const [choice, setChoice] = useState<{
        tab: string;
        against: string | null;
    } | null>(null);
    const contextualId = contextualTab?.id ?? null;

    const tabs = contextualTab ? [...RIBBON_TABS, contextualTab] : RIBBON_TABS;

    // A choice only holds while the selection it was made against persists;
    // when that changes, the contextual tab pops back to the front.
    const chosen =
        choice &&
        choice.against === contextualId &&
        tabs.some((item) => item.id === choice.tab)
            ? choice.tab
            : null;
    const activeId = chosen ?? contextualId ?? permanentTab;
    const tab = tabs.find((item) => item.id === activeId) ?? tabs[0];

    const selectTab = (id: string) => {
        setChoice({ tab: id, against: contextualId });

        if (id !== contextualId) {
            setPermanentTab(id);
        }
    };

    return (
        <div className="border-b border-chrome-border bg-chrome">
            <div className="flex items-end gap-0.5 px-2 pt-1">
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => selectTab(item.id)}
                        className={cn(
                            'rounded-t-sm px-3.5 py-1.5 text-[0.78rem] tracking-wide transition-colors',
                            item.contextual && 'ml-2',
                            item.id === activeId
                                ? item.contextual
                                    ? 'bg-chrome-raised text-ember'
                                    : 'bg-chrome-raised text-sand'
                                : item.contextual
                                  ? 'bg-ember/15 text-ember hover:bg-ember/25'
                                  : 'text-chrome-muted hover:bg-chrome-raised/60 hover:text-chrome-fg',
                        )}
                    >
                        {item.title}
                    </button>
                ))}
            </div>

            <div
                className={cn(
                    'flex scrollbar-chrome items-stretch gap-0 overflow-x-auto bg-chrome-raised px-2 py-1.5',
                    tab.contextual && 'border-t border-ember/40',
                )}
            >
                {tab.panels.map((panel) => (
                    <div
                        key={panel.id}
                        className="flex shrink-0 flex-col border-r border-chrome-border/70 px-2 last:border-r-0"
                    >
                        <div className="flex flex-1 items-start gap-1">
                            <div className="flex items-start gap-1">
                                {panel.buttons
                                    .filter((button) => button.size !== 'small')
                                    .map((button) => (
                                        <RibbonTool
                                            key={button.id}
                                            button={button}
                                            large
                                            active={isActive(
                                                button,
                                                activeTool,
                                                activeFixture,
                                                isToggled,
                                            )}
                                            disabled={isDisabled(button.action)}
                                            onAction={onAction}
                                        />
                                    ))}
                            </div>

                            {panel.buttons.some(
                                (button) => button.size === 'small',
                            ) && (
                                <div className="flex flex-col gap-0.5 py-0.5">
                                    {panel.buttons
                                        .filter(
                                            (button) => button.size === 'small',
                                        )
                                        .map((button) => (
                                            <RibbonTool
                                                key={button.id}
                                                button={button}
                                                active={isActive(
                                                    button,
                                                    activeTool,
                                                    activeFixture,
                                                    isToggled,
                                                )}
                                                disabled={isDisabled(
                                                    button.action,
                                                )}
                                                onAction={onAction}
                                            />
                                        ))}
                                </div>
                            )}
                        </div>

                        <div className="pt-1 text-center text-[0.65rem] tracking-wide text-chrome-muted">
                            {panel.title}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function isActive(
    button: RibbonButton,
    activeTool: ToolId,
    activeFixture: FixtureCategory,
    isToggled: (setting: ToggleId) => boolean,
): boolean {
    if (button.action.kind === 'tool') {
        return (
            button.action.tool === activeTool &&
            (button.action.fixture === undefined ||
                button.action.fixture === activeFixture)
        );
    }

    if (button.action.kind === 'toggle') {
        return isToggled(button.action.setting);
    }

    return false;
}

type RibbonToolProps = {
    button: RibbonButton;
    large?: boolean;
    active: boolean;
    disabled: boolean;
    onAction: (action: RibbonAction) => void;
};

function RibbonTool({
    button,
    large = false,
    active,
    disabled,
    onAction,
}: RibbonToolProps) {
    const Icon = button.icon;

    const trigger = (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onAction(button.action)}
            className={cn(
                'group flex items-center rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                large
                    ? 'w-[4.5rem] flex-col gap-1 px-1 py-1.5 text-center'
                    : 'w-full gap-1.5 px-1.5 py-1 text-left',
                active
                    ? 'bg-sand/20 text-sand ring-1 ring-sand/40'
                    : 'text-chrome-fg hover:bg-chrome/70',
            )}
        >
            <Icon
                className={cn(
                    'shrink-0',
                    large ? 'size-6 stroke-[1.4]' : 'size-4 stroke-[1.5]',
                )}
            />
            <span
                className={cn(
                    'leading-tight',
                    large
                        ? 'text-[0.68rem]'
                        : 'text-[0.7rem] whitespace-nowrap',
                )}
            >
                {button.label}
            </span>
        </button>
    );

    if (!button.hint && !button.shortcut) {
        return trigger;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-56">
                <p className="font-medium">{button.label}</p>
                {button.hint && (
                    <p className="text-xs opacity-80">{button.hint}</p>
                )}
                {button.shortcut && (
                    <p className="mt-0.5 text-xs opacity-60">
                        Shortcut: {button.shortcut}
                    </p>
                )}
            </TooltipContent>
        </Tooltip>
    );
}
