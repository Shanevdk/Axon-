import { Head } from '@inertiajs/react';
import AppearanceTabs from '@/components/appearance-tabs';
import Heading from '@/components/heading';
import { PalettePicker } from '@/components/palette-picker';
import { edit as editAppearance } from '@/routes/appearance';

export default function Appearance() {
    return (
        <>
            <Head title="Appearance settings" />

            <h1 className="sr-only">Appearance settings</h1>

            <div className="space-y-8">
                <section className="space-y-4">
                    <Heading
                        variant="small"
                        title="Light and dark"
                        description="How bright the interface is. System follows your device."
                    />
                    <AppearanceTabs />
                </section>

                <section className="space-y-4">
                    <Heading
                        variant="small"
                        title="Colour theme"
                        description="What colour it is. Saved in this browser, and it carries the whole interface."
                    />
                    <PalettePicker className="max-w-xl" />
                </section>
            </div>
        </>
    );
}

Appearance.layout = {
    breadcrumbs: [
        {
            title: 'Appearance settings',
            href: editAppearance(),
        },
    ],
};
