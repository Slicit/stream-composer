require "rails_helper"

RSpec.describe "Api::Registrations", type: :request do
  describe "POST /api/register" do
    it "creates a viewer account, sends a confirmation email, and does not sign the account in" do
      expect {
        post "/api/register", params: { username: "newperson", email: "newperson@example.com", password: "correct-horse-1" }, as: :json
      }.to change(User, :count).by(1).and change(ActionMailer::Base.deliveries, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(response.cookies["sc_session"]).to be_blank

      user = User.find_by(username: "newperson")
      expect(user.role).to eq("viewer")
      expect(user.email_confirmed_at).to be_nil
      expect(user.confirmation_token_digest).to be_present

      get "/api/auth/me", as: :json
      expect(JSON.parse(response.body)["user"]).to be_nil
    end

    it "SECURITY: ignores role/quota params — always creates a plain viewer with no quota" do
      post "/api/register", params: {
        username: "sneaky", email: "sneaky@example.com", password: "correct-horse-1",
        role: "admin", streamQuota: 500, compositorQuota: 20,
      }, as: :json

      user = User.find_by(username: "sneaky")
      expect(user.role).to eq("viewer")
      expect(user.stream_quota).to eq(0)
      expect(user.compositor_quota).to eq(0)
    end

    it "rejects a duplicate username" do
      User.create!(username: "taken", password: "correct-horse-1", role: "viewer")
      post "/api/register", params: { username: "taken", email: "new@example.com", password: "correct-horse-1" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end

    it "rejects a duplicate email" do
      User.create!(username: "first", email: "shared@example.com", password: "correct-horse-1", role: "viewer")
      post "/api/register", params: { username: "second", email: "shared@example.com", password: "correct-horse-1" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end

    it "rejects a malformed email" do
      post "/api/register", params: { username: "malformed", email: "not-an-email", password: "correct-horse-1" }, as: :json
      expect(response).to have_http_status(:bad_request)
      expect(User.exists?(username: "malformed")).to be false
    end

    it "rejects a weak password" do
      post "/api/register", params: { username: "weak", email: "weak@example.com", password: "short" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end
  end
end
