import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { NavBar } from './components/NavBar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { ViewerPage } from './pages/ViewerPage'

export function App() {
  return (
    <AuthProvider>
      <NavBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ViewerPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['admin']}>
              <main className="mx-auto w-full max-w-4xl px-4 py-8">
                <AdminUsersPage />
              </main>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
