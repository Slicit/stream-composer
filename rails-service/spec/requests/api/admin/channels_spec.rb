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

    it "shows a single channel regardless of ownership" do
      channel = Channel.create!(name: "Someone Else's", owner: viewer)
      get "/api/admin/channels/#{channel.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["channel"]["id"]).to eq(channel.id)
    end

    it "sets a channel's layout mode override" do
      channel = Channel.create!(name: "Room", owner: admin)
      patch "/api/admin/channels/#{channel.id}", params: { layoutMode: "maximize" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(channel.reload.layout_mode).to eq("maximize")
    end

    it "reassigns ownership on update" do
      channel = Channel.create!(name: "Room", owner: admin)
      patch "/api/admin/channels/#{channel.id}", params: { ownerId: viewer.id }, as: :json
      expect(response).to have_http_status(:ok)
      expect(channel.reload.owner_id).to eq(viewer.id)
    end

    describe "background image upload" do
      after { FileUtils.rm_rf(Rails.public_path.join("uploads", "channel-backgrounds")) }

      it "uploads a background for any channel regardless of ownership" do
        channel = Channel.create!(name: "Someone Else's", owner: viewer)
        put "/api/admin/channels/#{channel.id}/background", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
        expect(response).to have_http_status(:ok)
        expect(channel.reload.background_image).to eq("/uploads/channel-backgrounds/#{channel.id}.png")
      end

      it "refuses a disallowed content type" do
        channel = Channel.create!(name: "Room", owner: admin)
        put "/api/admin/channels/#{channel.id}/background", params: "not an image", headers: { "CONTENT_TYPE" => "text/plain" }
        expect(response).to have_http_status(:bad_request)
      end
    end
  end
end
