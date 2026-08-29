require "rails_helper"

RSpec.describe "Api::TwoFactor", type: :request do
  let!(:user) { User.create!(username: "totp-owner", password: "correct-horse-1", role: "viewer") }

  describe "POST /api/two-factor/setup" do
    it "returns a secret and a QR code SVG for the signed-in user" do
      sign_in_as(user, password: "correct-horse-1")
      post "/api/two-factor/setup", as: :json
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["otpSecret"]).to be_present
      expect(body["qrCodeSvg"]).to start_with("<?xml")
      expect(user.reload.otp_secret).to eq(body["otpSecret"])
      expect(user.otp_enabled).to be false
    end

    it "refuses an anonymous caller" do
      post "/api/two-factor/setup", as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/two-factor/enable" do
    it "enables 2FA once a real TOTP code confirms the secret" do
      sign_in_as(user, password: "correct-horse-1")
      post "/api/two-factor/setup", as: :json
      secret = JSON.parse(response.body)["otpSecret"]

      post "/api/two-factor/enable", params: { code: ROTP::TOTP.new(secret).now }, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.otp_enabled).to be true
    end

    it "refuses a wrong code and leaves 2FA disabled" do
      sign_in_as(user, password: "correct-horse-1")
      post "/api/two-factor/setup", as: :json

      post "/api/two-factor/enable", params: { code: "000000" }, as: :json
      expect(response).to have_http_status(:bad_request)
      expect(user.reload.otp_enabled).to be false
    end

    it "refuses when setup was never called" do
      sign_in_as(user, password: "correct-horse-1")
      post "/api/two-factor/enable", params: { code: "000000" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end
  end

  describe "POST /api/two-factor/disable" do
    # sign_in_as must run before otp_enabled flips true — login itself
    # branches away from minting a session once 2FA is on (see
    # Api::Auth#login), so this mirrors an existing session for a user
    # who enabled 2FA earlier in it, not a fresh 2FA login.
    before do
      sign_in_as(user, password: "correct-horse-1")
      user.update!(otp_secret: ROTP::Base32.random, otp_enabled: true)
    end

    it "disables 2FA when the current password is right" do
      post "/api/two-factor/disable", params: { currentPassword: "correct-horse-1" }, as: :json
      expect(response).to have_http_status(:ok)
      user.reload
      expect(user.otp_enabled).to be false
      expect(user.otp_secret).to be_nil
    end

    it "refuses the wrong current password and leaves 2FA enabled" do
      post "/api/two-factor/disable", params: { currentPassword: "wrong" }, as: :json
      expect(response).to have_http_status(:unauthorized)
      expect(user.reload.otp_enabled).to be true
    end
  end
end
