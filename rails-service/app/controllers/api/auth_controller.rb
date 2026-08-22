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
  end
end
