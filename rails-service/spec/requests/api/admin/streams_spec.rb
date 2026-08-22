require "rails_helper"

RSpec.describe "Api::Admin::Streams", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  describe "SECURITY: access control" do
    it "refuses an anonymous caller" do
      get "/api/admin/streams", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/streams", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "creates a stream, auto-generating its key" do
      post "/api/admin/streams", params: { name: "Camera 1" }, as: :json
      expect(response).to have_http_status(:created)
      body = JSON.parse(response.body)["stream"]
      expect(body["key"]).to be_present
      expect(body["visibility"]).to eq("private")
    end

    it "can reassign ownership, unlike the self-service endpoint" do
      streamer = User.create!(username: "streamer-1", password: "correct-horse-1", role: "streamer", stream_quota: 5)
      stream = Stream.create!(name: "Camera 1")
      patch "/api/admin/streams/#{stream.id}", params: { ownerId: streamer.id }, as: :json
      expect(response).to have_http_status(:ok)
      expect(stream.reload.owner_id).to eq(streamer.id)
    end

    it "rotates a stream's key" do
      stream = Stream.create!(name: "Camera 1")
      original_key = stream.key
      post "/api/admin/streams/#{stream.id}/rotate-key", as: :json
      expect(response).to have_http_status(:ok)
      expect(stream.reload.key).not_to eq(original_key)
    end

    it "deletes a stream" do
      stream = Stream.create!(name: "Camera 1")
      delete "/api/admin/streams/#{stream.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(Stream.exists?(stream.id)).to be false
    end
  end
end
