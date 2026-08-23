import { useEffect, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '@/api/client'
import type { Game } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// The featured-game catalog behind the Combobox on the channel editor —
// name only for now (see app/models/game.rb). Deleting one just clears
// it from any channel that had it featured, nothing here needs to guard
// against that.
export function AdminGamesPage() {
  const [games, setGames] = useState<Game[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ games: Game[] }>('/api/admin/games')
      setGames(data.games)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load games.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      await api.post('/api/admin/games', { name })
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the game.')
    } finally {
      setCreating(false)
    }
  }

  async function rename(id: string, nextName: string, previousName: string) {
    if (nextName === previousName) return
    setError(null)
    try {
      await api.patch(`/api/admin/games/${id}`, { name: nextName })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename the game.')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this game? Any channel featuring it will just show no game, not break.')) return
    setError(null)
    try {
      await api.delete(`/api/admin/games/${id}`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the game.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Games</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form className="flex flex-wrap items-end gap-3" onSubmit={handleCreate} aria-label="Add a game">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-game-name">Name</Label>
            <Input id="new-game-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required className="w-64" />
          </div>
          <Button type="submit" variant="outline" disabled={creating}>
            Add game
          </Button>
        </form>

        {games === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : games.length === 0 ? (
          <p className="text-muted-foreground">No games yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {games.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Input
                      defaultValue={g.name}
                      maxLength={100}
                      aria-label={`Name for ${g.name}`}
                      className="w-64"
                      onBlur={(e) => rename(g.id, e.target.value, g.name)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => remove(g.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
