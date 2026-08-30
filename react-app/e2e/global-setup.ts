import { execFileSync } from 'node:child_process'

// Seeds fixed accounts inside the already-running scmig-rails container so
// every spec run starts from known state, without needing anything set up
// by hand first. Uses execFileSync (an argv array, not a shell string) so
// the Ruby script never passes through shell interpretation.
export default function globalSetup() {
  const script = `
    User.find_by(username: "e2e-admin")&.destroy
    User.find_by(username: "e2e-target")&.destroy
    User.find_by(username: "e2e-2fa")&.destroy
    User.create!(username: "e2e-admin", password: "correct-horse-1", role: "admin")
    User.create!(username: "e2e-target", password: "correct-horse-1", role: "viewer",
                 otp_secret: ROTP::Base32.random, otp_enabled: true)
    # No 2FA set up yet — for specs that walk through self-service setup
    # from scratch (see two-factor.spec.ts).
    User.create!(username: "e2e-2fa", password: "correct-horse-1", role: "viewer")
    puts "e2e fixtures ready"
  `
  execFileSync('docker', ['exec', 'scmig-rails', 'bin/rails', 'runner', script], { stdio: 'inherit' })
}
