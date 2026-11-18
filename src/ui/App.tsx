import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import { createClient, UNAUTHORIZED_EVENT } from "./api.js";
import { createVestryAuthClient } from "./auth-client.js";
import { Shell } from "./components/Layout.js";
import { ErrorState, Loading, ToastProvider } from "./components/ui.js";
import { VestryContext } from "./context.js";
import { AssetsPage } from "./pages/Assets.js";
import { CollectionListPage } from "./pages/CollectionList.js";
import { DashboardPage } from "./pages/Dashboard.js";
import {
  CollectionEntryPage,
  NewEntryPage,
  SingletonPage,
} from "./pages/EntryEditor.js";
import { LoginPage } from "./pages/Login.js";
import { UsersPage } from "./pages/Users.js";

export function App({ basePath, name }: { basePath: string; name: string }) {
  const queryClient = useMemo(() => {
    const client: QueryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      // Every save is a commit, which starts a build: show it at once. Not
      // returned, because the mutation would wait for the refetch.
      mutationCache: new MutationCache({
        onSuccess: () => {
          void client.invalidateQueries({ queryKey: ["deploys"] });
        },
      }),
    });
    return client;
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter basename={basePath}>
          <Root basePath={basePath} name={name} />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function Root({ basePath, name }: { basePath: string; name: string }) {
  const api = useMemo(() => createClient(basePath), [basePath]);
  const authClient = useMemo(
    () => createVestryAuthClient(basePath),
    [basePath],
  );
  const location = useLocation();
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => api.config(),
    staleTime: Infinity,
  });
  // When a session expires mid-use the API answers 401; reloading the config
  // drops the user and the router falls back to the sign-in page.
  const refetch = configQuery.refetch;
  useEffect(() => {
    const onUnauthorized = () => void refetch();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refetch]);

  if (configQuery.isLoading) return <Loading page label="Loading Vestry…" />;
  if (configQuery.error || !configQuery.data) {
    return (
      <ErrorState
        page
        title="Vestry couldn't load"
        error={configQuery.error ?? "The server sent no configuration."}
        onRetry={() => void refetch()}
        retrying={configQuery.isFetching}
      >
        The control panel couldn't get its configuration from the server. This
        is often temporary, so try again in a minute.
      </ErrorState>
    );
  }
  const client = configQuery.data;
  const value = {
    basePath,
    name: client.config.name ?? name,
    api,
    authClient,
    client,
    config: client.config,
    refresh: async () => {
      await configQuery.refetch();
    },
  };

  if (!client.user) {
    return (
      <VestryContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="*"
            element={
              <Navigate
                to={`/login?next=${encodeURIComponent(basePath + location.pathname + location.search)}`}
                replace
              />
            }
          />
        </Routes>
      </VestryContext.Provider>
    );
  }

  return (
    <VestryContext.Provider value={value}>
      <Routes>
        <Route
          path="/login"
          element={
            <Navigate to={afterLogin(location.search, basePath)} replace />
          }
        />
        <Route
          path="*"
          element={
            <Shell>
              <Routes>
                <Route index element={<DashboardPage />} />
                <Route
                  path="collections/:collection"
                  element={<CollectionListPage />}
                />
                <Route
                  path="collections/:collection/new"
                  element={<NewEntryPage />}
                />
                <Route
                  path="collections/:collection/*"
                  element={<CollectionEntryPage />}
                />
                <Route
                  path="singletons/:singleton"
                  element={<SingletonPage />}
                />
                <Route path="assets/:container" element={<AssetsPage />} />
                <Route path="users" element={<UsersPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          }
        />
      </Routes>
    </VestryContext.Provider>
  );
}

/** Where to go after sign-in: the `next` the login page was sent with, made router-relative. */
function afterLogin(search: string, basePath: string): string {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  const base = basePath.replace(/\/$/, "");
  const underBase =
    next === base || next.startsWith(`${base}/`) || next.startsWith(`${base}?`);
  const rest = underBase ? next.slice(base.length) : next;
  return rest.startsWith("/") ? rest : `/${rest}`;
}
