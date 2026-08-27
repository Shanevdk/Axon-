import { Link, usePage } from '@inertiajs/react';
import {
    Armchair,
    Box,
    Building2,
    CalendarDays,
    LayoutGrid,
    MessagesSquare,
    NotebookPen,
    Sparkles,
    Users,
} from 'lucide-react';
import AppLogo from '@/components/app-logo';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { assistant, calendar, chat, dashboard } from '@/routes';
import { index as clients } from '@/routes/clients';
import { index as library } from '@/routes/library';
import { index as notes } from '@/routes/notes';
import { show as organization } from '@/routes/organization';
import { index as projects } from '@/routes/projects';
import type { NavItem } from '@/types';

export function AppSidebar() {
    const { auth } = usePage().props;

    const mainNavItems: NavItem[] = [
        {
            title: 'Studio',
            href: dashboard(),
            icon: LayoutGrid,
        },
        {
            title: 'Projects',
            href: projects(),
            icon: Box,
        },
        {
            title: 'Clients',
            href: clients(),
            icon: Users,
        },
        {
            title: 'Library',
            href: library(),
            icon: Armchair,
        },
        {
            title: 'Notebook',
            href: notes(),
            icon: NotebookPen,
        },
        {
            title: 'Calendar',
            href: calendar(),
            icon: CalendarDays,
        },
        {
            title: 'Chat',
            href: chat(),
            icon: MessagesSquare,
        },
        {
            title: 'Assistant',
            href: assistant(),
            icon: Sparkles,
        },
        {
            // The team's own name once they have one.
            title: auth.organization?.name ?? 'Organization',
            href: organization(),
            icon: Building2,
        },
    ];

    return (
        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href={dashboard()} prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={mainNavItems} />
            </SidebarContent>

            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
