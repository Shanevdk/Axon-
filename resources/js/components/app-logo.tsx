import AppLogoIcon from '@/components/app-logo-icon';

export default function AppLogo() {
    return (
        <>
            <div className="flex aspect-square size-8 items-center justify-center rounded-sm border border-sand/40 text-sand">
                <AppLogoIcon className="size-5" />
            </div>
            <div className="ml-1 grid flex-1 text-left leading-none">
                <span className="truncate text-sm font-semibold tracking-[0.2em]">
                    VANHAVEN
                </span>
                <span className="ax-eyebrow mt-1.5 text-[0.6rem] text-sand">
                    Design Software
                </span>
            </div>
        </>
    );
}
