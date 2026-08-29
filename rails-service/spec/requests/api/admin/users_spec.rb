require "rails_helper"

RSpec.describe "Api::Admin::Users", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  describe "SECURITY: access control" do
    it "refuses an anonymous caller" do
      get "/api/admin/users", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/users", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "refuses an anonymous caller on show/reset-2fa/avatar" do
      get "/api/admin/users/#{viewer.id}", as: :json
      expect(response).to have_http_status(:unauthorized)
      post "/api/admin/users/#{viewer.id}/reset-2fa", as: :json
      expect(response).to have_http_status(:unauthorized)
      put "/api/admin/users/#{viewer.id}/avatar", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a signed-in viewer on show/reset-2fa/avatar" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/users/#{admin.id}", as: :json
      expect(response).to have_http_status(:forbidden)
      post "/api/admin/users/#{admin.id}/reset-2fa", as: :json
      expect(response).to have_http_status(:forbidden)
      put "/api/admin/users/#{admin.id}/avatar", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "lists users without leaking password material" do
      get "/api/admin/users", as: :json
      body = JSON.parse(response.body)
      expect(body["users"].map { |u| u["username"] }).to include("admin-1", "viewer-1")
      expect(body["users"].first.keys).not_to include("salt", "password_hash", "passwordHash")
    end

    it "creates a streamer with a quota" do
      post "/api/admin/users", params: { username: "streamer-1", password: "correct-horse-1", role: "streamer", streamQuota: 3 }, as: :json
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)
      expect(body["user"]["role"]).to eq("streamer")
      expect(body["user"]["streamQuota"]).to eq(3)
    end

    it "updates a user's role and quota" do
      patch "/api/admin/users/#{viewer.id}", params: { role: "streamer", streamQuota: 2 }, as: :json
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["user"]["role"]).to eq("streamer")
      expect(body["user"]["streamQuota"]).to eq(2)
    end

    it "updates a user's compositor quota, defaulting to 0" do
      expect(viewer.compositor_quota).to eq(0)
      patch "/api/admin/users/#{viewer.id}", params: { compositorQuota: 3 }, as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["user"]["compositorQuota"]).to eq(3)
    end

    it "refuses to change an administrator's role" do
      patch "/api/admin/users/#{admin.id}", params: { role: "viewer" }, as: :json
      expect(response).to have_http_status(:bad_request)
      expect(admin.reload.role).to eq("admin")
    end

    it "deletes another user" do
      delete "/api/admin/users/#{viewer.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(User.exists?(viewer.id)).to be false
    end

    it "refuses to delete the account currently signed in with" do
      delete "/api/admin/users/#{admin.id}", as: :json
      expect(response).to have_http_status(:conflict)
      expect(User.exists?(admin.id)).to be true
    end

    it "shows a single user by id" do
      get "/api/admin/users/#{viewer.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["user"]["username"]).to eq("viewer-1")
    end

    it "force-resets another user's 2FA, no re-auth required" do
      viewer.update!(otp_secret: ROTP::Base32.random, otp_enabled: true)
      post "/api/admin/users/#{viewer.id}/reset-2fa", as: :json
      expect(response).to have_http_status(:ok)
      viewer.reload
      expect(viewer.otp_enabled).to be false
      expect(viewer.otp_secret).to be_nil
    end

    it "uploads an avatar on another user's account" do
      put "/api/admin/users/#{viewer.id}/avatar", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)["user"]
      expect(body["avatar"]).to eq("/uploads/avatars/#{viewer.id}.png")
      expect(File.exist?(Rails.public_path.join("uploads", "avatars", "#{viewer.id}.png"))).to be true
      FileUtils.rm_rf(Rails.public_path.join("uploads", "avatars"))
    end
  end

  describe "impersonation" do
    it "signs the admin in as the target user" do
      sign_in_as(admin, password: "correct-horse-1")
      post "/api/admin/users/#{viewer.id}/impersonate", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["user"]["username"]).to eq("viewer-1")

      get "/api/auth/me", as: :json
      body = JSON.parse(response.body)
      expect(body["user"]["username"]).to eq("viewer-1")
      expect(body["impersonatedBy"]["username"]).to eq("admin-1")
    end

    it "does not disturb the target's own real session elsewhere" do
      sign_in_as(viewer, password: "correct-horse-1")
      own_session_count = Session.where(user: viewer).count

      sign_in_as(admin, password: "correct-horse-1")
      post "/api/admin/users/#{viewer.id}/impersonate", as: :json

      expect(Session.where(user: viewer).count).to eq(own_session_count + 1)
    end

    it "refuses a non-admin" do
      sign_in_as(viewer, password: "correct-horse-1")
      post "/api/admin/users/#{admin.id}/impersonate", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "refuses impersonating yourself" do
      sign_in_as(admin, password: "correct-horse-1")
      post "/api/admin/users/#{admin.id}/impersonate", as: :json
      expect(response).to have_http_status(:bad_request)
    end

    it "refuses to impersonate a non-admin, since real permissions belong to whoever the session actually is" do
      sign_in_as(admin, password: "correct-horse-1")
      other = User.create!(username: "viewer-2", password: "correct-horse-1", role: "viewer")
      post "/api/admin/users/#{viewer.id}/impersonate", as: :json

      # Now signed in as viewer-1, who genuinely has no admin access —
      # impersonation is a real viewer session, not admin-with-a-mask.
      post "/api/admin/users/#{other.id}/impersonate", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "refuses to start a second impersonation while already impersonating (chained via an admin target)" do
      admin2 = User.create!(username: "admin-2", password: "correct-horse-1", role: "admin")
      sign_in_as(admin, password: "correct-horse-1")
      post "/api/admin/users/#{admin2.id}/impersonate", as: :json

      # Still admin-role (admin2 is an admin too), so require_admin! alone
      # would not have caught a second impersonate attempt here.
      post "/api/admin/users/#{viewer.id}/impersonate", as: :json
      expect(response).to have_http_status(:conflict)

      get "/api/auth/me", as: :json
      expect(JSON.parse(response.body)["user"]["username"]).to eq("admin-2")
    end
  end
end
