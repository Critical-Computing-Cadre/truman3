import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, get, post, type Researcher } from "./api.ts";
import "./index.css";
import { CastPage } from "./pages/CastPage.tsx";
import { DraftPage } from "./pages/DraftPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { MonitorPage } from "./pages/MonitorPage.tsx";
import { NewStudyPage } from "./pages/NewStudyPage.tsx";
import { PreviewPage } from "./pages/PreviewPage.tsx";
import { ProlificPage } from "./pages/ProlificPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SpacesPage } from "./pages/SpacesPage.tsx";
import { StudiesPage } from "./pages/StudiesPage.tsx";

/** Everything here needs signing in, so this shows the login page until then. */
function Shell() {
  const me = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => get<Researcher>("/admin/me"),
    retry: false,
  });
  const logout = useMutation({
    mutationFn: () => post("/admin/logout"),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign(import.meta.env.BASE_URL);
    },
  });

  if (me.error instanceof ApiError && me.error.status === 401) {
    return <LoginPage />;
  }
  if (me.error) {
    return <p className="p-6">Something went wrong. Please reload this page.</p>;
  }
  if (!me.data) {
    return null;
  }

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-4 bg-stone-900 px-4 py-2 text-sm text-white">
        <Link to="/" className="mr-auto font-semibold">
          Truman 3
        </Link>
        <span className="hidden sm:inline">{me.data.name}</span>
        <button type="button" className="underline" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </header>
      <Outlet />
    </div>
  );
}

const rootRoute = createRootRoute({ component: Shell });

const studiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: StudiesPage,
});

const previewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preview/$versionId",
  component: PreviewPage,
});

const draftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId",
  component: DraftPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/settings",
  component: SettingsPage,
});

const newStudyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studies/new",
  component: NewStudyPage,
});

const castRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/cast",
  component: CastPage,
});

const spacesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/spaces",
  component: SpacesPage,
});

const monitorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studies/$studyId/monitor",
  component: MonitorPage,
});

const prolificRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/studies/$studyId/prolific",
  component: ProlificPage,
});

const router = createRouter({
  // "/admin/" from the build, without the last slash.
  basepath: import.meta.env.BASE_URL.replace(/\/$/, ""),
  routeTree: rootRoute.addChildren([
    studiesRoute,
    newStudyRoute,
    previewRoute,
    draftRoute,
    settingsRoute,
    castRoute,
    spacesRoute,
    monitorRoute,
    prolificRoute,
  ]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
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
