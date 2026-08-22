import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ChannelPrefsProvider } from './contexts/ChannelPrefsContext'
import { NavBar } from './components/NavBar'
import { LeftNav } from './components/LeftNav'
import { ImpersonationBanner } from './components/ImpersonationBanner'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminStreamsPage } from './pages/admin/AdminStreamsPage'
import { AdminRelaysPage } from './pages/admin/AdminRelaysPage'
import { AdminChannelsPage } from './pages/admin/AdminChannelsPage'
import { AdminStatsPage } from './pages/admin/AdminStatsPage'
import { ViewerPage } from './pages/ViewerPage'
import { ChannelViewerPage } from './pages/ChannelViewerPage'
import { StreamerPage } from './pages/StreamerPage'
import { ChannelsPage } from './pages/ChannelsPage'

export function App() {
  return (
    <AuthProvider>
      <ChannelPrefsProvider>
        <div className="flex min-h-svh flex-col">
          <NavBar />
          <div className="flex flex-1 items-stretch">
            <LeftNav />
            <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
              <Routes>
                <Route path="/login" element={<LoginPage />} />
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
                  <Route path="streams" element={<AdminStreamsPage />} />
                  <Route path="relays" element={<AdminRelaysPage />} />
                  <Route path="channels" element={<AdminChannelsPage />} />
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
              </Routes>
            </main>
          </div>
        </div>
        <ImpersonationBanner />
      </ChannelPrefsProvider>
    </AuthProvider>
  )
}
