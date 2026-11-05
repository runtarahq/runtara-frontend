import React from 'react';
import { Outlet } from 'react-router';
import {
  SidebarInset,
  SidebarProvider,
} from '@/shared/components/ui/sidebar.tsx';
import { Sidebar } from './Sidebar.tsx';
import { NavigationBlocker } from '@/shared/components/NavigationBlocker';

interface LayoutProps {
  children?: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <SidebarProvider>
      <div className="pt-safe flex min-h-dvh w-full overflow-hidden">
        <Sidebar />
        <SidebarInset className="flex min-w-0 flex-col overflow-y-auto overflow-x-hidden bg-muted/30 dark:bg-background">
          <div className="pb-safe flex-1">{children ?? <Outlet />}</div>
        </SidebarInset>
      </div>
      <NavigationBlocker />
    </SidebarProvider>
  );
}
