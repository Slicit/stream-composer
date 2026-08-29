module Api
  class AuthController < ApplicationController
    include AvatarUploadable

    before_action :require_user!, only: %i[stop_impersonating avatar]

    def login
      user = User.authenticate_credentials(params[:username], params[:password])
      return render_unauthorized("Wrong username or password.") unless user
      return render_error(:forbidden, "Confirm your email before signing in.") if user.email_confirmation_required?

      # No Session/cookie is minted here when 2FA is on — only a short-
      # lived TwoFactorChallenge, returned in the body, never a cookie.
      # A leaked step-1 response is therefore not a partial session; there
      # is no session yet at all. See #verify_two_factor.
      if user.otp_enabled?
        challenge = TwoFactorChallenge.start_for(user)
        return render json: { twoFactorRequired: true, challengeToken: challenge.raw_token }
      end

      sign_in(user)
      user.update_column(:last_login_at, Time.current)
      render json: { user: user.as_public_json }
    end

    # Step two of a 2FA login: exchanges a live TwoFactorChallenge plus a
    # real TOTP code for an actual signed-in session.
    def verify_two_factor
      challenge = TwoFactorChallenge.authenticate(params[:challengeToken])
      return render_unauthorized("This sign-in attempt has expired — sign in again.") unless challenge

      unless challenge.user.verify_otp(params[:code])
        return render_unauthorized("Invalid code.")
      end

      challenge.destroy
      sign_in(challenge.user)
      challenge.user.update_column(:last_login_at, Time.current)
      render json: { user: challenge.user.as_public_json }
    end

    def logout
      sign_out
      head :no_content
    end

    def me
      render json: { user: current_user&.as_public_json, impersonatedBy: impersonator_json }
    end

    # Ends impersonation by minting a fresh session for the admin who
    # started it (Session#impersonator) — not by trying to resurrect
    # their original session/cookie, which the impersonate action never
    # kept around. The impersonated session is discarded; it was only
    # ever a means to view the app as that user.
    def stop_impersonating
      impersonator = current_session&.impersonator
      return render_error(:conflict, "You are not impersonating anyone.") unless impersonator

      current_session.destroy
      sign_in(impersonator)
      render json: { user: impersonator.as_public_json }
    end

    # Self-service password change — the "Edit" action in the account
    # dropdown. Deliberately narrow: only the password, requiring the
    # current one, unlike Api::Admin::UsersController#update (role/quota,
    # no current-password check, since that's an administrator acting on
    # someone else's account).
    def update_me
      return require_user! unless current_user

      unless current_user.authenticate(params[:currentPassword].to_s)
        return render_unauthorized("Current password is incorrect.")
      end

      current_user.password = params[:newPassword]
      if current_user.save
        render json: { user: current_user.as_public_json }
      else
        render_error :bad_request, current_user.errors.full_messages.join(", ")
      end
    end

    # Self-service avatar upload — cropped client-side (see
    # AvatarCropField), uploaded here as raw image bytes with the
    # cropper's own Content-Type, same no-multipart-parsing pattern as
    # Api::ChannelsController#background. See AvatarUploadable.
    def avatar
      store_avatar!(current_user)
    end

    private

    def impersonator_json
      current_session&.impersonator&.as_public_json
    end
  end
end
