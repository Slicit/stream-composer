import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginPage() {
  const { user, login, verifyTwoFactor } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [otpCode, setOtpCode] = useState('')

  if (user) {
    const from = (location.state as { from?: string } | null)?.from || '/'
    return <Navigate to={from} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await login(username, password)
      if (result.twoFactorRequired) {
        setChallengeToken(result.challengeToken)
      } else {
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerifyTwoFactor(e: FormEvent) {
    e.preventDefault()
    if (!challengeToken) return
    setError(null)
    setSubmitting(true)
    try {
      await verifyTwoFactor(challengeToken, otpCode)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Deliberately not full width — a login form stretched across the
    // page reads as broken, not as "using the space"; see
    // UI_CONVENTIONS.md's exceptions section.
    <div className="mx-auto mt-16 w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>{challengeToken ? 'Enter your code' : 'Sign in'}</CardTitle>
        </CardHeader>
        <CardContent>
          {challengeToken ? (
            <form className="flex flex-col gap-4" onSubmit={handleVerifyTwoFactor}>
              <p className="text-sm text-muted-foreground">
                Enter the 6-digit code from your authenticator app, or one of your backup codes.
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="otp-code">Code</Label>
                <Input
                  id="otp-code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  autoFocus
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" variant="outline" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify'}
              </Button>
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4"
                onClick={() => {
                  setChallengeToken(null)
                  setOtpCode('')
                  setError(null)
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" variant="outline" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
              <Link to="/register" className="text-sm text-muted-foreground underline underline-offset-4">
                Don't have an account? Register
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
