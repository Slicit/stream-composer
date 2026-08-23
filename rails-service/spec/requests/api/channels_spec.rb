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

    it "B cannot view A's channel via the edit-page endpoint" do
      sign_in_as(viewer_b, password: "correct-horse-1")
      get "/api/channels/mine/#{channel_a.id}", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "GET /api/channels/mine/:id (the edit page)" do
    it "returns the owner's own channel" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "My Channel" }, as: :json
      id = JSON.parse(response.body)["channel"]["id"]

      get "/api/channels/mine/#{id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["channel"]["id"]).to eq(id)
    end
  end

  describe "layout mode" do
    it "sets and clears the layout mode override" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "My Channel" }, as: :json
      id = JSON.parse(response.body)["channel"]["id"]

      patch "/api/channels/mine/#{id}", params: { layoutMode: "maximize" }, as: :json
      expect(JSON.parse(response.body)["channel"]["layoutMode"]).to eq("maximize")

      patch "/api/channels/mine/#{id}", params: { layoutMode: nil }, as: :json
      expect(JSON.parse(response.body)["channel"]["layoutMode"]).to be_nil
    end

    it "rejects an invalid layout mode" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "My Channel" }, as: :json
      id = JSON.parse(response.body)["channel"]["id"]

      patch "/api/channels/mine/#{id}", params: { layoutMode: "bogus" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end
  end

  describe "GET /api/channels (every channel this user can view)" do
    let!(:public_channel) do
      sign_in_as(viewer_b, password: "correct-horse-1")
      post "/api/channels/mine", params: { name: "B's public channel", visibility: "public" }, as: :json
      Channel.find(JSON.parse(response.body)["channel"]["id"])
    end
    let!(:private_channel) do
      post "/api/channels/mine", params: { name: "B's private channel" }, as: :json
      Channel.find(JSON.parse(response.body)["channel"]["id"])
    end
    let!(:shared_channel) do
      post "/api/channels/mine", params: { name: "B's shared channel", sharedWith: [viewer_a.id] }, as: :json
      Channel.find(JSON.parse(response.body)["channel"]["id"])
    end

    it "includes public and explicitly shared channels, not a stranger's private one" do
      sign_in_as(viewer_a, password: "correct-horse-1")
      get "/api/channels", as: :json
      ids = JSON.parse(response.body)["channels"].map { |c| c["id"] }
      expect(ids).to include(public_channel.id, shared_channel.id)
      expect(ids).not_to include(private_channel.id)
    end

    it "the owner sees all three of their own channels regardless of visibility" do
      sign_in_as(viewer_b, password: "correct-horse-1")
      get "/api/channels", as: :json
      ids = JSON.parse(response.body)["channels"].map { |c| c["id"] }
      expect(ids).to include(public_channel.id, private_channel.id, shared_channel.id)
    end

    it "refuses an anonymous caller" do
      # The let!s above sign in as viewer_b to create the fixture
      # channels, which leaves this example's session cookie jar
      # authenticated unless explicitly cleared first.
      delete "/api/auth/logout", as: :json
      get "/api/channels", as: :json
      expect(response).to have_http_status(:unauthorized)
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
