import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { RequestsPage } from './pages/requests/RequestsPage';
import { TemplatesPage } from './pages/templates/TemplatesPage';
import { CreateRequestPage } from './pages/requests/CreateRequestPage';
import { TemplateEditorPage } from './pages/templates/editor/TemplateEditorPage';
import { UsersPage } from './pages/users/UsersPage';
import { RadicadosPage } from './pages/radicados/RadicadosPage';
import { InstitutionsPage } from './pages/institutions/InstitutionsPage';
import { AuditPage } from './pages/audit/AuditPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { ValidationPage } from './pages/validation/ValidationPage';
import { ValidateHomePage } from './pages/validation/ValidateHomePage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { SignMinutePage } from './pages/minutes/SignMinutePage';
import { MinutesPage } from './pages/minutes/MinutesPage';
import { LoadingScreen } from './components/ui/LoadingScreen';
import { getRobotoFontData } from './lib/pdfFonts';

function PrivateRoute({ children, roles }: { children: React.ReactNode; roles?: string[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;

  return <Layout>{children}</Layout>;
}

export default function App() {
  const { user, isLoading } = useAuth();

  // ── Preload Roboto font for PDF generation ──
  useEffect(() => {
    getRobotoFontData().then(fontData => {
      if (fontData) {
        console.log('✅ Roboto font preloaded for PDF generation');
      } else {
        console.log('ℹ️ Roboto font not available, PDFs will use Helvetica');
      }
    });
  }, []);

  if (isLoading) return <LoadingScreen />;

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />

      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <DashboardPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/requests/new"
        element={
          <PrivateRoute>
            <CreateRequestPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/requests/edit/:id"
        element={
          <PrivateRoute>
            <CreateRequestPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/requests"
        element={
          <PrivateRoute>
            <RequestsPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/templates"
        element={
          <PrivateRoute roles={['ADMIN']}>
            <TemplatesPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/templates/editor"
        element={
          <PrivateRoute roles={['ADMIN']}>
            <TemplateEditorPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/users"
        element={
          <PrivateRoute roles={['ADMIN']}>
            <UsersPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/radicados"
        element={
          <PrivateRoute roles={['ADMIN']}>
            <RadicadosPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/institutions"
        element={
          <PrivateRoute roles={['ADMIN']}>
            <InstitutionsPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/audit"
        element={
          <PrivateRoute roles={['ADMIN']}>
            <AuditPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/reports"
        element={
          <PrivateRoute>
            <ReportsPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/minutes"
        element={
          <PrivateRoute>
            <MinutesPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <SettingsPage />
          </PrivateRoute>
        }
      />

      {/* Public routes — no auth required */}
      <Route path="/validate" element={<ValidateHomePage />} />
      <Route path="/validate/:code" element={<ValidationPage />} />
      <Route path="/sign/:token" element={<SignMinutePage />} />

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
