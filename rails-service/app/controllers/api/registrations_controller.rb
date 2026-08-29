module Api
  # Public self-registration. Always creates a "viewer" account — role is
  # hardcoded here, never read from params, which is the one thing
  # standing between this public form and someone registering themselves
  # as an admin. Never signs the account in; the mailed confirmation link
  # is required first (see EmailConfirmationsController and
  # AuthController#login's email_confirmation_required? gate).
  class RegistrationsController < ApplicationController
    def create
      user = User.new(username: params[:username], email: params[:email], password: params[:password], role: "viewer")
      return render_error(:bad_request, user.errors.full_messages.join(", ")) unless user.save

      raw_token = user.generate_confirmation_token!
      begin
        UserMailer.confirmation_email(user, raw_token).deliver_now
      rescue StandardError => e
        # A flaky SMTP server must never turn a successful registration
        # into a failed API response — EmailConfirmationsController#resend
        # is the recovery path if the mail genuinely never arrived.
        Rails.logger.error("confirmation email failed to send: #{e.message}")
      end

      render json: { message: "Check #{user.email} to confirm your account before signing in." }, status: :created
    end
  end
end
