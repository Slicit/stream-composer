require "rails_helper"

RSpec.describe "Api::Auth", type: :request do
  let!(:user) { User.create!(username: "alice", password: "correct-horse-1", role: "viewer") }

  describe "POST /api/auth/login" do
    it "signs in with the right credentials and sets the session cookie" do
      post "/api/auth/login", params: { username: "alice", password: "correct-horse-1" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(response.cookies["sc_session"]).to be_present
      expect(JSON.parse(response.body)["user"]["username"]).to eq("alice")
    end

    it "refuses the wrong password" do
      post "/api/auth/login", params: { username: "alice", password: "wrong" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "never reveals whether the username exists" do
      post "/api/auth/login", params: { username: "nobody", password: "whatever1" }, as: :json
      expect(response).to have_http_status(:unauthorized)
      expect(JSON.parse(response.body)["error"]).to eq("Wrong username or password.")
    end
  end

  describe "GET /api/auth/me" do
    it "is nil when signed out" do
      get "/api/auth/me", as: :json
      expect(JSON.parse(response.body)["user"]).to be_nil
    end

    it "reflects the signed-in user" do
      sign_in_as(user, password: "correct-horse-1")
      get "/api/auth/me", as: :json
      expect(JSON.parse(response.body)["user"]["username"]).to eq("alice")
    end
  end

  describe "PATCH /api/auth/me (self-service password change)" do
    it "changes the password when the current one is right" do
      sign_in_as(user, password: "correct-horse-1")
      patch "/api/auth/me", params: { currentPassword: "correct-horse-1", newPassword: "new-horse-battery-2" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(User.authenticate_credentials("alice", "new-horse-battery-2")).to eq(user)
    end

    it "refuses when the current password is wrong" do
      sign_in_as(user, password: "correct-horse-1")
      patch "/api/auth/me", params: { currentPassword: "wrong", newPassword: "new-horse-battery-2" }, as: :json
      expect(response).to have_http_status(:unauthorized)
      expect(User.authenticate_credentials("alice", "correct-horse-1")).to eq(user)
    end

    it "refuses a weak new password" do
      sign_in_as(user, password: "correct-horse-1")
      patch "/api/auth/me", params: { currentPassword: "correct-horse-1", newPassword: "short" }, as: :json
      expect(response).to have_http_status(:bad_request)
      expect(User.authenticate_credentials("alice", "correct-horse-1")).to eq(user)
    end

    it "refuses an anonymous caller" do
      patch "/api/auth/me", params: { currentPassword: "x", newPassword: "new-horse-battery-2" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/auth/logout" do
    it "ends the session so /api/auth/me goes back to nil" do
      sign_in_as(user, password: "correct-horse-1")
      delete "/api/auth/logout", as: :json
      expect(response).to have_http_status(:no_content)

      get "/api/auth/me", as: :json
      expect(JSON.parse(response.body)["user"]).to be_nil
    end
  end

  describe "DELETE /api/auth/impersonate (stop impersonating)" do
    let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }

    it "returns to the admin's own session" do
      sign_in_as(admin, password: "correct-horse-1")
      post "/api/admin/users/#{user.id}/impersonate", as: :json

      delete "/api/auth/impersonate", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["user"]["username"]).to eq("admin-1")

      get "/api/auth/me", as: :json
      body = JSON.parse(response.body)
      expect(body["user"]["username"]).to eq("admin-1")
      expect(body["impersonatedBy"]).to be_nil
    end

    it "discards the impersonated session" do
      sign_in_as(admin, password: "correct-horse-1")
      post "/api/admin/users/#{user.id}/impersonate", as: :json
      impersonated_count = Session.where(user: user).count

      delete "/api/auth/impersonate", as: :json
      expect(Session.where(user: user).count).to eq(impersonated_count - 1)
    end

    it "refuses when not currently impersonating" do
      sign_in_as(user, password: "correct-horse-1")
      delete "/api/auth/impersonate", as: :json
      expect(response).to have_http_status(:conflict)
    end

    it "refuses an anonymous caller" do
      delete "/api/auth/impersonate", as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "PUT /api/auth/me/avatar" do
    after { FileUtils.rm_rf(Rails.public_path.join("uploads", "avatars")) }

    it "stores the cropped image and records its URL on the caller's own account" do
      sign_in_as(user, password: "correct-horse-1")
      put "/api/auth/me/avatar", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)["user"]
      expect(body["avatar"]).to eq("/uploads/avatars/#{user.id}.png")
      expect(File.exist?(Rails.public_path.join("uploads", "avatars", "#{user.id}.png"))).to be true
    end

    it "refuses a disallowed content type" do
      sign_in_as(user, password: "correct-horse-1")
      put "/api/auth/me/avatar", params: "not an image", headers: { "CONTENT_TYPE" => "text/plain" }
      expect(response).to have_http_status(:bad_request)
    end

    it "refuses a file larger than 5MB" do
      sign_in_as(user, password: "correct-horse-1")
      put "/api/auth/me/avatar", params: ("a" * (5 * 1024 * 1024 + 1)), headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:bad_request)
    end

    it "refuses an anonymous caller" do
      put "/api/auth/me/avatar", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
