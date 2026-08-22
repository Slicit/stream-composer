require "rails_helper"

RSpec.describe "Api::Admin::Relays", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }
  let!(:stream) { Stream.create!(name: "Camera 1") }

  describe "SECURITY: access control" do
    it "refuses an anonymous caller" do
      get "/api/admin/relays", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/relays", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "lists providers alongside relays" do
      get "/api/admin/relays", as: :json
      body = JSON.parse(response.body)
      expect(body["providers"].map { |p| p["id"] }).to include("twitch", "youtube", "custom")
    end

    it "creates a destination for any stream" do
      post "/api/admin/relays", params: { streamId: stream.id, provider: "twitch", key: "a-key" }, as: :json
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)["relay"]
      expect(body["streamId"]).to eq(stream.id)
      expect(body["keyMasked"]).not_to eq("a-key")
    end

    it "deletes a destination" do
      relay = stream.relay_destinations.create!(provider: "custom", url: "rtmp://example.test/live")
      delete "/api/admin/relays/#{relay.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(RelayDestination.exists?(relay.id)).to be false
    end
  end
end
