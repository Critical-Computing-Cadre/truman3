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
import { EditProfilePage } from "./pages/EditProfilePage.tsx";
import { ExplorePage, PlacePage, TagPage } from "./pages/ExplorePage.tsx";
import { FeedPage } from "./pages/FeedPage.tsx";
import { FlowGate } from "./pages/FlowGate.tsx";
import { JoinPage } from "./pages/JoinPage.tsx";
import { ConversationPage, MessagesPage } from "./pages/MessagesPage.tsx";
import { ModLogPage } from "./pages/ModLogPage.tsx";
import { NotificationsPage } from "./pages/NotificationsPage.tsx";
import { PilotPage } from "./pages/PilotPage.tsx";
import { PostPage } from "./pages/PostPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { RulesPage } from "./pages/RulesPage.tsx";
import { SpacePage, SpacesPage } from "./pages/SpacesPage.tsx";
import { track } from "./tracking.ts";

function PageViews() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!pathname.startsWith("/join/") && !pathname.startsWith("/pilot/")) {
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

const pilotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pilot/$token",
  component: PilotPage,
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

const spacesRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/spaces",
  component: SpacesPage,
});

const spaceRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/spaces/$key",
  component: SpacePage,
});

const postRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/p/$postId",
  component: PostPage,
});

const notificationsRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/notifications",
  component: NotificationsPage,
});

const messagesRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/messages",
  component: MessagesPage,
});

const conversationRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/messages/$username",
  component: ConversationPage,
});

const rulesRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/rules",
  validateSearch: (search: Record<string, unknown>): { from: "label" | "menu" } => ({
    from: search.from === "label" ? "label" : "menu",
  }),
  component: RulesPage,
});

const exploreRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/explore",
  component: ExplorePage,
});

const tagRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/tags/$tag",
  component: TagPage,
});

const placeRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/places/$place",
  component: PlacePage,
});

const modLogRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/mod-log",
  component: ModLogPage,
});

const spaceModLogRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/spaces/$key/mod-log",
  component: ModLogPage,
});

const profileRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/u/$username",
  component: ProfilePage,
});

const editProfileRoute = createRoute({
  getParentRoute: () => gateRoute,
  path: "/account",
  component: EditProfilePage,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    joinRoute,
    pilotRoute,
    gateRoute.addChildren([
      feedRoute,
      spacesRoute,
      spaceRoute,
      postRoute,
      notificationsRoute,
      messagesRoute,
      rulesRoute,
      conversationRoute,
      modLogRoute,
      exploreRoute,
      tagRoute,
      placeRoute,
      spaceModLogRoute,
      profileRoute,
      editProfileRoute,
    ]),
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
