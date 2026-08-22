module Api
  class AuthController < ApplicationController
    before_action :require_user!, only: %i[stop_impersonating]

    def login
      user = User.authenticate_credentials(params[:username], params[:password])
      return render_unauthorized("Wrong username or password.") unless user

      sign_in(user)
      user.update_column(:last_login_at, Time.current)
      render json: { user: user.as_public_json }
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

    private

    def impersonator_json
      current_session&.impersonator&.as_public_json
    end
  end
end
