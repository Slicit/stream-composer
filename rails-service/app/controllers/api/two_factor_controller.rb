module Api
  # Self-service TOTP setup — optional, never required at signup (see
  # AuthController#login's otp_enabled branch for the actual login-time
  # second factor). Admin can force-reset a locked-out user's 2FA — see
  # Api::Admin::UsersController#reset_two_factor.
  class TwoFactorController < ApplicationController
    before_action :require_user!

    # May be called repeatedly before #enable — each call simply
    # overwrites otp_secret, harmless since otp_enabled stays false until
    # a real code proves the secret was actually scanned.
    def setup
      secret = ROTP::Base32.random
      current_user.update!(otp_secret: secret)
      totp = ROTP::TOTP.new(secret, issuer: "Stream Composer")
      qr = RQRCode::QRCode.new(totp.provisioning_uri(current_user.username))
      render json: { otpSecret: secret, qrCodeSvg: qr.as_svg(module_size: 4, standalone: true) }
    end

    def enable
      return render_error(:bad_request, "Set up two-factor authentication first.") if current_user.otp_secret.blank?
      unless current_user.verify_otp(params[:code])
        return render_error(:bad_request, "That code didn't match — check your authenticator app and try again.")
      end

      current_user.update!(otp_enabled: true)
      # Only time these are ever returned in plaintext — same shape as
      # #setup returning otpSecret once before it's ever persisted-and-
      # hidden.
      backup_codes = current_user.generate_backup_codes!
      render json: { user: current_user.as_public_json, backupCodes: backup_codes }
    end

    def disable
      return render_unauthorized("Current password is incorrect.") unless current_user.authenticate(params[:currentPassword].to_s)

      current_user.update!(otp_enabled: false, otp_secret: nil, otp_backup_code_digests: [])
      render json: { user: current_user.as_public_json }
    end

    # Self-service — replaces the whole set, invalidating any codes from
    # before. Requires the current password, same re-auth bar as #disable
    # (this is a security-relevant self-service action, not an
    # administrative override).
    def regenerate_backup_codes
      return render_error(:bad_request, "Two-factor authentication is not enabled.") unless current_user.otp_enabled?
      return render_unauthorized("Current password is incorrect.") unless current_user.authenticate(params[:currentPassword].to_s)

      backup_codes = current_user.generate_backup_codes!
      render json: { user: current_user.as_public_json, backupCodes: backup_codes }
    end
  end
end
