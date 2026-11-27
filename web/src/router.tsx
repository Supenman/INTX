import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";
import { Spin } from "antd";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import HomePage from "@/pages/home";

const AssetsPage = lazy(() => import("@/pages/assets"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const CanvasFlowPilotPage = lazy(() => import("@/pages/canvas-flow-pilot"));
const ConfigPage = lazy(() => import("@/pages/config"));
const NotFound = lazy(() => import("@/pages/not-found"));
const TasksPage = lazy(() => import("@/pages/tasks"));
const EditingStudioPage = lazy(() => import("@/pages/editing-studio"));
const SkillsPage = lazy(() => import("@/pages/skills"));

function LazyRoute({ children }: { children: ReactNode }) {
    return (
        <Suspense fallback={<div className="flex h-full items-center justify-center bg-background"><Spin /></div>}>
            {children}
        </Suspense>
    );
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/assets", element: <LazyRoute><AssetsPage /></LazyRoute> },
            { path: "/skills", element: <LazyRoute><SkillsPage /></LazyRoute> },
            { path: "/tasks", element: <LazyRoute><TasksPage /></LazyRoute> },
            { path: "/canvas", element: <LazyRoute><CanvasPage /></LazyRoute> },
            { path: "/canvas/:id", element: <LazyRoute><CanvasProjectPage /></LazyRoute> },
            { path: "/canvas-flow-pilot", element: <LazyRoute><CanvasFlowPilotPage /></LazyRoute> },
            { path: "/editing-studio", element: <LazyRoute><EditingStudioPage /></LazyRoute> },
            { path: "/config", element: <LazyRoute><ConfigPage /></LazyRoute> },
        ],
    },
    { path: "*", element: <LazyRoute><NotFound /></LazyRoute> },
]);
