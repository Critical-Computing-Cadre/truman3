import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { FeedPage } from "./pages/FeedPage.tsx";
import { FlowGate } from "./pages/FlowGate.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { NotificationsPage } from "./pages/NotificationsPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { track } from "./tracking.ts";

function PageViews() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!pathname.startsWith("/join/")) {
      track({ type: "page.viewed", payload: { page: pathname } });
    }
  }, [pathname]);

  return <Outlet />;
}

const rootRoute = createRootRoute({ component: PageViews });

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join/$slug",
  component: JoinPage,
});

/** Everything past joining goes through the study's flow. The feed pages only show on its feed step. */
const gateRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "gate",
  component: FlowGate,
});

const feedRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/",
  component: FeedPage,
});

const notificationsRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/notifications",
  component: NotificationsPage,
});

const profileRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/u/$username",
  component: ProfilePage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    joinRoute,
    gateRoute.addChildren([feedRoute, notificationsRoute, profileRoute]),
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
