module Api
  class AuthController < ApplicationController
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
      render json: { user: current_user&.as_public_json }
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
  end
end
