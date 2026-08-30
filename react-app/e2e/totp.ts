import { execFileSync } from 'node:child_process'

// Computes a real TOTP code the same way an authenticator app would,
// using the same ROTP gem the server verifies against — shelled out via
// docker exec since these specs run directly on the dev box already
// (see global-setup.ts for the same pattern).
export function computeTotp(secret: string): string {
  return execFileSync('docker', ['exec', 'scmig-rails', 'bin/rails', 'runner', `puts ROTP::TOTP.new(${JSON.stringify(secret)}).now`])
    .toString()
    .trim()
}
