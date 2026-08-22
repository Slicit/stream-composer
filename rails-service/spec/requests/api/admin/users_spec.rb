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
  end
end
