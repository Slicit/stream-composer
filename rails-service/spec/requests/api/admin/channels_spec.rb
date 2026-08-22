require "rails_helper"

RSpec.describe "Api::Admin::Channels", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  describe "SECURITY: access control" do
    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/channels", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "creates a channel, defaulting ownership to the admin" do
      post "/api/admin/channels", params: { name: "Community Room" }, as: :json
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)["channel"]
      expect(body["ownerId"]).to eq(admin.id)
      expect(body["slug"]).to eq("community-room")
    end

    it "can create a channel owned by someone else" do
      post "/api/admin/channels", params: { name: "Their Room", ownerId: viewer.id }, as: :json
      expect(JSON.parse(response.body)["channel"]["ownerId"]).to eq(viewer.id)
    end

    it "sets and clears the homepage channel" do
      channel = Channel.create!(name: "Home", owner: admin)

      put "/api/admin/channels/#{channel.id}/homepage", as: :json
      expect(response).to have_http_status(:ok)
      expect(AppSetting.instance.homepage_channel_id).to eq(channel.id)

      delete "/api/admin/channels/#{channel.id}/homepage", as: :json
      expect(response).to have_http_status(:no_content)
      expect(AppSetting.instance.homepage_channel_id).to be_nil
    end

    it "deletes a channel and moderates any owner's channel regardless of ownership" do
      channel = Channel.create!(name: "Someone Else's", owner: viewer)
      delete "/api/admin/channels/#{channel.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(Channel.exists?(channel.id)).to be false
    end
  end
end
