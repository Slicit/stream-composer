import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { NavBar } from './components/NavBar'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { AdminUsersPage } from './pages/AdminUsersPage'
import { HomePage } from './pages/HomePage'

export function App() {
  return (
    <AuthProvider>
      <NavBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<HomePage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['admin']}>
              <main className="wrap">
                <AdminUsersPage />
              </main>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
