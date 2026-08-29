import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ChannelPrefsProvider, useChannelPrefs } from './contexts/ChannelPrefsContext'
import { NavBar } from './components/NavBar'
import { LeftNav } from './components/LeftNav'
import { ImpersonationBanner } from './components/ImpersonationBanner'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ConfirmEmailPage } from './pages/ConfirmEmailPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { AdminUserEditPage } from './pages/admin/AdminUserEditPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminStreamsPage } from './pages/admin/AdminStreamsPage'
import { AdminRelaysPage } from './pages/admin/AdminRelaysPage'
import { AdminChannelsPage } from './pages/admin/AdminChannelsPage'
import { AdminChannelEditPage } from './pages/admin/AdminChannelEditPage'
import { AdminGamesPage } from './pages/admin/AdminGamesPage'
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage'
import { AdminStatsPage } from './pages/admin/AdminStatsPage'
import { ViewerPage } from './pages/ViewerPage'
import { ChannelViewerPage } from './pages/ChannelViewerPage'
import { StreamerPage } from './pages/StreamerPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { ChannelEditPage } from './pages/ChannelEditPage'

// A channel's background image must cover <main> itself — the actual
// content area next to the left nav — not just whatever box a page's own
// markup happens to draw, or it sits behind opaque page content and is
// never seen (the bug this replaced). ChannelViewerPage only ever reports
// the image into ChannelPrefsContext; this is the one place that paints
// it, since <main> is a sibling of that page in the tree, not an
// ancestor it could reach directly.
function AppMain({ children }: { children: ReactNode }) {
  const { backgroundImage } = useChannelPrefs()
  return (
    <main
      className="min-w-0 flex-1 bg-cover bg-center px-4 py-6 md:px-6"
      style={backgroundImage ? { backgroundImage: `url(${backgroundImage})` } : undefined}
    >
      {children}
    </main>
  )
}

export function App() {
  return (
    <AuthProvider>
      <ChannelPrefsProvider>
        <div className="flex min-h-svh flex-col">
          <NavBar />
          <div className="flex flex-1 items-stretch">
            <LeftNav />
            <AppMain>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/confirm-email" element={<ConfirmEmailPage />} />
                <Route path="/" element={<ViewerPage />} />
                <Route path="/c/:slug" element={<ChannelViewerPage />} />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute roles={['admin']}>
                      <AdminLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<AdminUsersPage />} />
                  <Route path="users/:id" element={<AdminUserEditPage />} />
                  <Route path="streams" element={<AdminStreamsPage />} />
                  <Route path="relays" element={<AdminRelaysPage />} />
                  <Route path="channels" element={<AdminChannelsPage />} />
                  <Route path="channels/:id" element={<AdminChannelEditPage />} />
                  <Route path="games" element={<AdminGamesPage />} />
                  <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="stats" element={<AdminStatsPage />} />
                </Route>
                <Route
                  path="/streamer"
                  element={
                    <ProtectedRoute roles={['streamer', 'admin']}>
                      <StreamerPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/channels"
                  element={
                    <ProtectedRoute>
                      <ChannelsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/channels/:id"
                  element={
                    <ProtectedRoute>
                      <ChannelEditPage />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </AppMain>
          </div>
        </div>
        <ImpersonationBanner />
      </ChannelPrefsProvider>
    </AuthProvider>
  )
}
