require "rails_helper"

RSpec.describe "Api::Relays (self-service /relays/mine)", type: :request do
  let!(:plain_viewer) { User.create!(username: "plain-viewer", password: "correct-horse-1", role: "viewer") }
  let!(:streamer_a) { User.create!(username: "streamer-a", password: "correct-horse-1", role: "streamer", stream_quota: 5) }
  let!(:streamer_b) { User.create!(username: "streamer-b", password: "correct-horse-1", role: "streamer", stream_quota: 5) }
  let!(:stream_a) { streamer_a.owned_streams.create!(name: "A cam") }
  let!(:stream_b) { streamer_b.owned_streams.create!(name: "B cam") }

  describe "SECURITY: access control" do
    it "refuses a plain viewer" do
      sign_in_as(plain_viewer, password: "correct-horse-1")
      get "/api/relays/mine", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "creating a destination" do
    before { sign_in_as(streamer_a, password: "correct-horse-1") }

    it "succeeds for the caller's own stream" do
      post "/api/relays/mine", params: { streamId: stream_a.id, provider: "twitch", key: "a-key" }, as: :json
      expect(response).to have_http_status(:created)
    end

    it "SECURITY: is refused for another streamer's stream" do
      post "/api/relays/mine", params: { streamId: stream_b.id, provider: "twitch", key: "a-key" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(stream_b.relay_destinations.count).to eq(0)
    end
  end

  describe "SECURITY: cross-tenant isolation on an existing destination" do
    let!(:relay) { stream_a.relay_destinations.create!(provider: "twitch", key: "a-key") }

    it "B does not see A's destination in their own list" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      get "/api/relays/mine", as: :json
      ids = JSON.parse(response.body)["relays"].map { |r| r["id"] }
      expect(ids).not_to include(relay.id)
    end

    it "B cannot edit A's destination" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      patch "/api/relays/mine/#{relay.id}", params: { enabled: false }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(relay.reload.enabled).to be true
    end

    it "B cannot delete A's destination" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      delete "/api/relays/mine/#{relay.id}", as: :json
      expect(response).to have_http_status(:forbidden)
      expect(RelayDestination.exists?(relay.id)).to be true
    end

    it "B cannot reveal A's destination key" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      get "/api/relays/mine/#{relay.id}/key", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "A cannot reassign the destination onto B's stream" do
      sign_in_as(streamer_a, password: "correct-horse-1")
      patch "/api/relays/mine/#{relay.id}", params: { streamId: stream_b.id }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(relay.reload.stream_id).to eq(stream_a.id)
    end

    it "A can reveal their own destination's key" do
      sign_in_as(streamer_a, password: "correct-horse-1")
      get "/api/relays/mine/#{relay.id}/key", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["key"]).to eq("a-key")
    end
  end
end
