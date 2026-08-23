require "rails_helper"

RSpec.describe "Api::Admin::Settings", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  describe "SECURITY: access control" do
    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/settings", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "refuses an anonymous caller" do
      get "/api/admin/settings", as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "shows the current settings" do
      get "/api/admin/settings", as: :json
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)["settings"]
      expect(body["defaultLayoutMode"]).to eq("fixed")
      expect(body["publicViewing"]).to eq(false)
    end

    it "updates the default layout mode" do
      patch "/api/admin/settings", params: { defaultLayoutMode: "maximize" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["settings"]["defaultLayoutMode"]).to eq("maximize")
      expect(AppSetting.instance.default_layout_mode).to eq("maximize")
    end

    it "updates public viewing" do
      patch "/api/admin/settings", params: { publicViewing: true }, as: :json
      expect(JSON.parse(response.body)["settings"]["publicViewing"]).to eq(true)
    end

    it "rejects an invalid layout mode" do
      patch "/api/admin/settings", params: { defaultLayoutMode: "bogus" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end
  end
end
