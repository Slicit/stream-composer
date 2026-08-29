require "rails_helper"

RSpec.describe "Api::EmailConfirmations", type: :request do
  describe "POST /api/confirm-email" do
    let!(:user) { User.create!(username: "confirmer", email: "confirmer@example.com", password: "correct-horse-1", role: "viewer") }

    it "confirms a valid token and lets the account sign in afterward" do
      raw_token = user.generate_confirmation_token!
      post "/api/confirm-email", params: { token: raw_token }, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.email_confirmed_at).to be_present
      expect(user.confirmation_token_digest).to be_nil

      post "/api/auth/login", params: { username: "confirmer", password: "correct-horse-1" }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "rejects an unknown or garbage token" do
      post "/api/confirm-email", params: { token: "not-a-real-token" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end

    it "rejects an expired token" do
      raw_token = user.generate_confirmation_token!
      user.update_column(:confirmation_sent_at, 49.hours.ago)
      post "/api/confirm-email", params: { token: raw_token }, as: :json
      expect(response).to have_http_status(:bad_request)
    end
  end

  describe "POST /api/confirm-email/resend" do
    it "SECURITY: responds identically whether or not the email has a pending registration" do
      User.create!(username: "pending", email: "pending@example.com", password: "correct-horse-1", role: "viewer")

      post "/api/confirm-email/resend", params: { email: "pending@example.com" }, as: :json
      known_body = response.body
      known_status = response.status

      post "/api/confirm-email/resend", params: { email: "nobody-here@example.com" }, as: :json
      expect(response.status).to eq(known_status)
      expect(response.body).to eq(known_body)
    end

    it "sends a fresh confirmation email for a real, still-unconfirmed address" do
      User.create!(username: "pending2", email: "pending2@example.com", password: "correct-horse-1", role: "viewer")
      expect {
        post "/api/confirm-email/resend", params: { email: "pending2@example.com" }, as: :json
      }.to change(ActionMailer::Base.deliveries, :count).by(1)
    end

    it "does not resend for an already-confirmed address" do
      User.create!(username: "already", email: "already@example.com", password: "correct-horse-1", role: "viewer", email_confirmed_at: Time.current)
      expect {
        post "/api/confirm-email/resend", params: { email: "already@example.com" }, as: :json
      }.not_to change(ActionMailer::Base.deliveries, :count)
    end
  end
end
