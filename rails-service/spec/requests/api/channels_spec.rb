require "rails_helper"

RSpec.describe "Api::Channels (self-service /channels/mine)", type: :request do
  let!(:viewer_a) { User.create!(username: "viewer-a", password: "correct-horse-1", role: "viewer") }
  let!(:viewer_b) { User.create!(username: "viewer-b", password: "correct-horse-1", role: "viewer") }

  describe "any signed-in user, not just streamer/admin, may own channels" do
    it "creates a channel as a plain viewer" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "My Channel" }, as: :json
      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["channel"]["ownerId"]).to eq(viewer_a.id)
    end

    it "refuses an anonymous caller" do
      post "/api/channels/mine", params: { name: "Nope" }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "SECURITY: cross-tenant isolation" do
    let!(:channel_a) do
      sign_in_as(viewer_a, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "A's channel" }, as: :json
      Channel.find(JSON.parse(response.body)["channel"]["id"])
    end

    it "B does not see A's channel in their own list" do
      sign_in_as(viewer_b, password: "correct-horse-1")
      get "/api/channels/mine", as: :json
      ids = JSON.parse(response.body)["channels"].map { |c| c["id"] }
      expect(ids).not_to include(channel_a.id)
    end

    it "B cannot edit A's channel" do
      sign_in_as(viewer_b, password: "correct-horse-1")
      patch "/api/channels/mine/#{channel_a.id}", params: { name: "Hijacked" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(channel_a.reload.name).to eq("A's channel")
    end

    it "B cannot delete A's channel" do
      sign_in_as(viewer_b, password: "correct-horse-1")
      delete "/api/channels/mine/#{channel_a.id}", as: :json
      expect(response).to have_http_status(:forbidden)
      expect(Channel.exists?(channel_a.id)).to be true
    end

    it "B cannot upload a background image for A's channel" do
      sign_in_as(viewer_b, password: "correct-horse-1")
      put "/api/channels/mine/#{channel_a.id}/background", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "background image upload" do
    let!(:channel) do
      sign_in_as(viewer_a, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "A's channel" }, as: :json
      Channel.find(JSON.parse(response.body)["channel"]["id"])
    end

    after { FileUtils.rm_rf(Rails.public_path.join("uploads", "channel-backgrounds")) }

    it "stores the image and records its URL" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      put "/api/channels/mine/#{channel.id}/background", params: "fake-png-bytes", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)["channel"]
      expect(body["backgroundImage"]).to eq("/uploads/channel-backgrounds/#{channel.id}.png")
      expect(File.exist?(Rails.public_path.join("uploads", "channel-backgrounds", "#{channel.id}.png"))).to be true
    end

    it "refuses a disallowed content type" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      put "/api/channels/mine/#{channel.id}/background", params: "not an image", headers: { "CONTENT_TYPE" => "text/plain" }
      expect(response).to have_http_status(:bad_request)
    end

    it "refuses an empty body" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      put "/api/channels/mine/#{channel.id}/background", params: "", headers: { "CONTENT_TYPE" => "image/png" }
      expect(response).to have_http_status(:bad_request)
    end
  end
end
