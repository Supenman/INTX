import { createBrowserRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import CanvasFlowPilotPage from "@/pages/canvas-flow-pilot";
import ConfigPage from "@/pages/config";
import NotFound from "@/pages/not-found";
import TasksPage from "@/pages/tasks";
import EditingStudioPage from "@/pages/editing-studio";
import SkillsPage from "@/pages/skills";
import HomePage from "@/pages/home";

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
            { path: "/assets", element: <AssetsPage /> },
            { path: "/skills", element: <SkillsPage /> },
            { path: "/tasks", element: <TasksPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/canvas-flow-pilot", element: <CanvasFlowPilotPage /> },
            { path: "/editing-studio", element: <EditingStudioPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
