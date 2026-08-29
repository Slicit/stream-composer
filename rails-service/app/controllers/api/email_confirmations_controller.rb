module Api
  class EmailConfirmationsController < ApplicationController
    # POST, not GET, even though the token arrives via a mailed link —
    # the React confirm-email page reads the token off its own URL and
    # posts it, keeping the token out of Rails' own access logs.
    def create
      user = User.find_by_confirmation_token(params[:token])
      return render_error(:bad_request, "This confirmation link is invalid or has expired.") unless user

      user.update!(email_confirmed_at: Time.current, confirmation_token_digest: nil, confirmation_sent_at: nil)
      render json: { message: "Email confirmed — you can now sign in." }
    end

    # SECURITY: enumeration-resistant on purpose, mirroring
    # User.authenticate_credentials's own decoy-hash stance — the response
    # is identical whether or not the address has an account, or is
    # already confirmed.
    def resend
      user = User.find_by("lower(email) = ?", params[:email].to_s.strip.downcase)
      if user && user.email_confirmed_at.nil?
        raw_token = user.generate_confirmation_token!
        begin
          UserMailer.confirmation_email(user, raw_token).deliver_now
        rescue StandardError => e
          Rails.logger.error("confirmation email resend failed: #{e.message}")
        end
      end
      render json: { message: "If that email has a pending registration, a new confirmation link is on its way." }
    end
  end
end
