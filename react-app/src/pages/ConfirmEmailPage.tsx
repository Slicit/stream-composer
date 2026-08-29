import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Status = 'confirming' | 'confirmed' | 'error'

export function ConfirmEmailPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [status, setStatus] = useState<Status>('confirming')
  const [message, setMessage] = useState<string | null>(null)

  const [resendEmail, setResendEmail] = useState('')
  const [resendMessage, setResendMessage] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  // The confirmation token is single-use — a second POST for the same
  // token (React StrictMode's dev-only double-invoked effect, or a fast
  // re-render) would fail even though the first one already succeeded,
  // and race to overwrite a successful result with that failure. This
  // ref makes the request fire at most once per token, not once per
  // effect run.
  const attemptedToken = useRef<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('This confirmation link is missing its token.')
      return
    }
    if (attemptedToken.current === token) return
    attemptedToken.current = token
    api
      .post<{ message: string }>('/api/confirm-email', { token })
      .then((data) => {
        setStatus('confirmed')
        setMessage(data.message)
      })
      .catch((err) => {
        setStatus('error')
        setMessage(err instanceof ApiError ? err.message : 'Something went wrong.')
      })
  }, [token])

  async function handleResend(e: FormEvent) {
    e.preventDefault()
    setResendMessage(null)
    setResending(true)
    try {
      const data = await api.post<{ message: string }>('/api/confirm-email/resend', { email: resendEmail })
      setResendMessage(data.message)
    } catch (err) {
      setResendMessage(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="mx-auto mt-16 w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Confirm your email</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {status === 'confirming' && <p className="text-sm text-muted-foreground">Confirming…</p>}

          {status === 'confirmed' && (
            <>
              <p className="text-sm">{message}</p>
              <Link to="/login" className="text-sm underline underline-offset-4">
                Sign in
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <p className="text-sm text-destructive" role="alert">
                {message}
              </p>
              <form className="flex flex-col gap-3 border-t pt-4" onSubmit={handleResend}>
                <p className="text-sm text-muted-foreground">Request a new confirmation link:</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="resend-email">Email</Label>
                  <Input id="resend-email" type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} required />
                </div>
                {resendMessage && <p className="text-sm">{resendMessage}</p>}
                <Button type="submit" variant="outline" disabled={resending}>
                  {resending ? 'Sending…' : 'Resend confirmation email'}
                </Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
