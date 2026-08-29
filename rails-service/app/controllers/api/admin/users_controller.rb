module Api
  module Admin
    class UsersController < ApplicationController
      include AvatarUploadable

      before_action :require_admin!

      def index
        render json: { users: User.order(:created_at).map(&:as_public_json) }
      end

      def show
        render json: { user: User.find(params[:id]).as_public_json }
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
        unless params[:compositorQuota].nil?
          user.compositor_quota = params[:compositorQuota]
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

      # Signs the caller in as `target` while remembering who started it
      # (Session#impersonator), so Api::AuthController#stop_impersonating
      # can mint a fresh session for the real admin without a second
      # login. before_action already guarantees current_user is an admin;
      # this only adds the two impersonation-specific refusals.
      def impersonate
        if current_session&.impersonator_id.present?
          return render_error(:conflict, "Stop impersonating before impersonating someone else.")
        end
        target = User.find(params[:id])
        if target.id == current_user.id
          return render_error(:bad_request, "You are already signed in as yourself.")
        end

        sign_in(target, impersonator: current_user)
        render json: { user: target.as_public_json }
      end

      # Administrative override — clears both otp fields regardless of the
      # admin's own password, unlike the self-service disable action.
      # This is the "unlock a locked-out user" path.
      def reset_two_factor
        user = User.find(params[:id])
        user.update!(otp_enabled: false, otp_secret: nil)
        render json: { user: user.as_public_json }
      end

      def avatar
        store_avatar!(User.find(params[:id]))
      end

      private

      def user_create_params
        params.permit(:username, :password, :role, :streamQuota, :compositorQuota).to_h.transform_keys do |k|
          { "streamQuota" => :stream_quota, "compositorQuota" => :compositor_quota }.fetch(k, k)
        end
      end
    end
  end
end
