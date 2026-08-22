module Api
  module Admin
    class UsersController < ApplicationController
      before_action :require_admin!

      def index
        render json: { users: User.order(:created_at).map(&:as_public_json) }
      end

      def create
        user = User.new(user_create_params)
        if user.save
          render json: { user: user.as_public_json }, status: :created
        else
          render_error :bad_request, user.errors.full_messages.join(", ")
        end
      end

      def update
        user = User.find(params[:id])
        changed = false

        if params[:role].present?
          user.role = params[:role]
          changed = true
        end
        if params[:password].present?
          user.password = params[:password]
          changed = true
        end
        unless params[:streamQuota].nil?
          user.stream_quota = params[:streamQuota]
          changed = true
        end

        return render_error(:bad_request, "Nothing to change.") unless changed

        if user.save
          render json: { user: user.as_public_json }
        else
          render_error :bad_request, user.errors.full_messages.join(", ")
        end
      end

      def destroy
        if params[:id] == current_user.id
          return render_error(:conflict, "You cannot delete the account you are signed in with.")
        end
        user = User.find(params[:id])
        if user.destroy
          render json: { ok: true }
        else
          render_error :conflict, user.errors.full_messages.join(", ")
        end
      end

      private

      def user_create_params
        params.permit(:username, :password, :role, :streamQuota).to_h.transform_keys do |k|
          k == "streamQuota" ? :stream_quota : k
        end
      end
    end
  end
end
