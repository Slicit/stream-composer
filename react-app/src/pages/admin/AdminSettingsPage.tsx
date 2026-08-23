import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api/client'
import type { AppSettings, LayoutMode } from '@/api/types'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// The site-wide settings singleton (see AppSetting) — currently the
// default grid layout mode new channels inherit, and whether an
// anonymous visitor may watch at all. Saves immediately on change, same
// pattern as the visibility/homepage toggles elsewhere in admin, rather
// than a separate "Save" button for two fields.
export function AdminSettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const data = await api.get<{ settings: AppSettings }>('/api/admin/settings')
      setSettings(data.settings)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function update(patch: Partial<AppSettings>) {
    setError(null)
    setSaving(true)
    try {
      const data = await api.patch<{ settings: AppSettings }>('/api/admin/settings', patch)
      setSettings(data.settings)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the setting.')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error ?? 'Loading…'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-start justify-between gap-6 border-b pb-6">
          <div className="space-y-1">
            <Label htmlFor="default-layout-mode">Default grid layout</Label>
            <p className="text-sm text-muted-foreground">
              What a new channel uses until it picks its own. Fixed lays streams into a 1920x1080 canvas; Maximize packs them into
              whatever page space is actually available, always leaving room for the channel's title and description.
            </p>
          </div>
          <Select
            value={settings.defaultLayoutMode}
            onValueChange={(v) => update({ defaultLayoutMode: v as LayoutMode })}
            disabled={saving}
          >
            <SelectTrigger id="default-layout-mode" aria-label="Default grid layout" className="w-48 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed (1920x1080)</SelectItem>
              <SelectItem value="maximize">Maximize page space</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <Label htmlFor="public-viewing">Allow public viewing</Label>
            <p className="text-sm text-muted-foreground">Lets an anonymous, signed-out visitor watch the composed programme.</p>
          </div>
          <Switch
            id="public-viewing"
            checked={settings.publicViewing}
            onCheckedChange={(checked) => update({ publicViewing: checked })}
            disabled={saving}
            aria-label="Allow public viewing"
          />
        </div>
      </CardContent>
    </Card>
  )
}
