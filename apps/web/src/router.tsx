import { createBrowserRouter, Navigate, Outlet } from "react-router";
import { lazy, Suspense } from "react";
import { AppShell } from "./components/layout/AppShell";
import { RequireAuth, RequireRole } from "./components/layout/guards";
import { PageLoader } from "./components/ui/PageLoader";

/**
 * Carte des routes de l'application (section 3 & 30).
 * Chaque page vit dans src/pages/<Nom>Page.tsx et est chargée à la demande.
 */
const SplashPage = lazy(() => import("./pages/SplashPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const MapPage = lazy(() => import("./pages/MapPage"));
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const AreaPage = lazy(() => import("./pages/AreaPage"));
const ReportWizardPage = lazy(() => import("./pages/ReportWizardPage"));
const ReportDetailPage = lazy(() => import("./pages/ReportDetailPage"));
const AroundPage = lazy(() => import("./pages/AroundPage"));
const CommunityPage = lazy(() => import("./pages/CommunityPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const PreferencesPage = lazy(() => import("./pages/PreferencesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const OfflinePage = lazy(() => import("./pages/OfflinePage"));
const FlagContentPage = lazy(() => import("./pages/FlagContentPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const ProDashboardPage = lazy(() => import("./pages/ProDashboardPage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const NavigationPage = lazy(() => import("./pages/NavigationPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

function S({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/", element: <S><SplashPage /></S> },
  { path: "/onboarding", element: <S><OnboardingPage /></S> },
  { path: "/auth/login", element: <S><LoginPage /></S> },
  { path: "/auth/register", element: <S><RegisterPage /></S> },
  { path: "/legal", element: <S><LegalPage /></S> },
  {
    element: (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
    children: [
      { path: "/navigate", element: <S><NavigationPage /></S> },
      { path: "/map", element: <S><MapPage /></S> },
      { path: "/explore", element: <S><ExplorePage /></S> },
      { path: "/explore/:areaId", element: <S><AreaPage /></S> },
      { path: "/around", element: <S><AroundPage /></S> },
      { path: "/community", element: <S><CommunityPage /></S> },
      { path: "/reports/:id", element: <S><ReportDetailPage /></S> },
      { path: "/profile", element: <S><RequireAuth><ProfilePage /></RequireAuth></S> },
      { path: "/profile/preferences", element: <S><RequireAuth><PreferencesPage /></RequireAuth></S> },
      { path: "/profile/settings", element: <S><RequireAuth><SettingsPage /></RequireAuth></S> },
      { path: "/notifications", element: <S><RequireAuth><NotificationsPage /></RequireAuth></S> },
      { path: "/offline", element: <S><OfflinePage /></S> },
    ],
  },
  // Écrans plein écran (sans barre de navigation)
  { path: "/report", element: <S><RequireAuth><ReportWizardPage /></RequireAuth></S> },
  { path: "/report/:step", element: <S><RequireAuth><ReportWizardPage /></RequireAuth></S> },
  { path: "/flag/:reportId", element: <S><RequireAuth><FlagContentPage /></RequireAuth></S> },
  {
    path: "/admin/*",
    element: <S><RequireRole roles={["moderator", "admin"]}><AdminPage /></RequireRole></S>,
  },
  {
    path: "/pro/*",
    element: <S><RequireRole roles={["official", "partner", "admin"]}><ProDashboardPage /></RequireRole></S>,
  },
  { path: "/home", element: <Navigate to="/navigate" replace /> },
  { path: "*", element: <S><NotFoundPage /></S> },
]);
