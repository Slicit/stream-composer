class UserMailer < ApplicationMailer
  def confirmation_email(user, raw_token)
    @user = user
    @confirm_url = "#{frontend_base_url}/confirm-email?token=#{raw_token}"
    mail(to: user.email, subject: "Confirm your Stream Composer account")
  end

  private

  def frontend_base_url
    host = ENV["PUBLIC_HOST"].presence || ENV["DOMAIN"].presence || "localhost:5173"
    scheme = Rails.env.production? ? "https" : "http"
    "#{scheme}://#{host}"
  end
end
