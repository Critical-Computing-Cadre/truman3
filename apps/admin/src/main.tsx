import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, get, post, type Researcher } from "./api.ts";
import { Frame } from "./components/Shell.tsx";
import "./index.css";
import { AgentPage } from "./pages/AgentPage.tsx";
import { BeatsPage } from "./pages/BeatsPage.tsx";
import { CastPage } from "./pages/CastPage.tsx";
import { DraftPage } from "./pages/DraftPage.tsx";
import { LabPage } from "./pages/LabPage.tsx";
import { InvitePage, ResetPage } from "./pages/LinkPages.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { ModerationPage } from "./pages/ModerationPage.tsx";
import { MonitorPage } from "./pages/MonitorPage.tsx";
import { NewStudyPage } from "./pages/NewStudyPage.tsx";
import { OperatorPage } from "./pages/OperatorPage.tsx";
import { PersonasPage } from "./pages/PersonasPage.tsx";
import { PreviewPage } from "./pages/PreviewPage.tsx";
import { ProlificPage } from "./pages/ProlificPage.tsx";
import { ScenariosPage } from "./pages/ScenariosPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { SimulatePage } from "./pages/SimulatePage.tsx";
import { SpacesPage } from "./pages/SpacesPage.tsx";
import { StoriesPage } from "./pages/StoriesPage.tsx";
import { StudiesPage } from "./pages/StudiesPage.tsx";
import { TokensPage } from "./pages/TokensPage.tsx";

/** Tells a lab that's waiting for approval, or suspended, what it can do now (ADR 70). */
function TeamNotice({ teams }: { teams: Researcher["teams"] }) {
  const waiting = teams.filter(({ status }) => status === "pending");
  const suspended = teams.filter(({ status }) => status === "suspended");
  const names = (list: Researcher["teams"]) => list.map(({ name }) => name).join(", ");
  if (waiting.length === 0 && suspended.length === 0) {
    return null;
  }
  return (
    <div role="status" className="flex flex-col gap-1 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      {waiting.length > 0 && (
        <p>
          <span className="font-medium">{names(waiting)}</span> is waiting to be approved. You can
          build, preview, and test studies now, and open them to participants once it's approved.
        </p>
      )}
      {suspended.length > 0 && (
        <p>
          <span className="font-medium">{names(suspended)}</span> is suspended, so its studies are
          closed to participants. Please get in touch with whoever runs this Truman.
        </p>
      )}
    </div>
  );
}

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

  // An emailed link's page works signed in or not (ADR 72).
  const linkPage = window.location.pathname.replace(/\/$/, "").split("/").at(-1);
  if (linkPage === "reset") {
    return <ResetPage />;
  }
  if (linkPage === "invite") {
    return <InvitePage />;
  }
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
    <Frame
      me={me.data}
      onSignOut={() => logout.mutate()}
      notice={<TeamNotice teams={me.data.teams} />}
    >
      <Outlet />
    </Frame>
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

const moderationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/moderation",
  component: ModerationPage,
});

const beatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/beats",
  component: BeatsPage,
});

const scenariosRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/scenarios",
  component: ScenariosPage,
});

const personasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/personas",
  component: PersonasPage,
});

const simulateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/versions/$versionId/simulate",
  component: SimulatePage,
});

const storiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/stories",
  component: StoriesPage,
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

const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/drafts/$draftId/agent",
  component: AgentPage,
});

const labRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lab",
  component: LabPage,
});

const operatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/operator",
  component: OperatorPage,
});

const tokensRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tokens",
  component: TokensPage,
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
    moderationRoute,
    beatsRoute,
    scenariosRoute,
    personasRoute,
    simulateRoute,
    storiesRoute,
    monitorRoute,
    prolificRoute,
    tokensRoute,
    operatorRoute,
    labRoute,
    agentRoute,
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
