import { useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// First 4 characters plus a fixed run of asterisks — enough to tell two
// keys apart at a glance (8 characters total) without ever rendering the
// real key to the DOM.
function maskKey(key: string): string {
  return `${key.slice(0, 4)}****`
}

interface KeyFieldProps {
  value: string
  onRotate: () => void
  label: string
}

export function KeyField({ value, onRotate, label }: KeyFieldProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <Input
          type="text"
          readOnly
          value={maskKey(value)}
          aria-label={label}
          className="h-8 w-24 truncate whitespace-nowrap pr-7 font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 h-7 w-7 -translate-y-1/2"
          onClick={handleCopy}
          title="Copy key"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="sr-only">Copy key</span>
        </Button>
      </div>
      <Button type="button" variant="outline" size="icon" onClick={onRotate} title="Rotate key">
        <RefreshCw className="h-4 w-4" />
        <span className="sr-only">Rotate key</span>
      </Button>
    </div>
  )
}
