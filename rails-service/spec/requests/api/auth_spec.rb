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

  describe "POST /api/auth/logout" do
    it "ends the session so /api/auth/me goes back to nil" do
      sign_in_as(user, password: "correct-horse-1")
      delete "/api/auth/logout", as: :json
      expect(response).to have_http_status(:no_content)

      get "/api/auth/me", as: :json
      expect(JSON.parse(response.body)["user"]).to be_nil
    end
  end
end
