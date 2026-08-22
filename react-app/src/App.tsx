import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { NavBar } from './components/NavBar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminStreamsPage } from './pages/admin/AdminStreamsPage'
import { AdminRelaysPage } from './pages/admin/AdminRelaysPage'
import { AdminChannelsPage } from './pages/admin/AdminChannelsPage'
import { ViewerPage } from './pages/ViewerPage'
import { ChannelViewerPage } from './pages/ChannelViewerPage'
import { StreamerPage } from './pages/StreamerPage'
import { ChannelsPage } from './pages/ChannelsPage'

export function App() {
  return (
    <AuthProvider>
      <NavBar />
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
    </AuthProvider>
  )
}
