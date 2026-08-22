require "rails_helper"

RSpec.describe "Internal::Streams", type: :request do
  let!(:owner) { User.create!(username: "owner-1", password: "correct-horse-1", role: "streamer", stream_quota: 5) }
  let!(:stream) { owner.owned_streams.create!(name: "Cam", visibility: "private", shared_with: []) }

  around do |example|
    original = ENV["INTERNAL_API_TOKEN"]
    ENV["INTERNAL_API_TOKEN"] = "test-internal-secret"
    example.run
    ENV["INTERNAL_API_TOKEN"] = original
  end

  it "SECURITY: refuses a request with the wrong token" do
    get "/internal/wrong-token/streams", as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "SECURITY: refuses every request when no token is configured" do
    ENV["INTERNAL_API_TOKEN"] = nil
    get "/internal/test-internal-secret/streams", as: :json
    expect(response).to have_http_status(:unauthorized)
  end

  it "returns every stream's data-plane-relevant fields, keyed for the Go bridge" do
    get "/internal/test-internal-secret/streams", as: :json
    expect(response).to have_http_status(:ok)
    body = JSON.parse(response.body)
    entry = body["streams"].find { |s| s["id"] == stream.id }
    expect(entry).to include(
      "key" => stream.key,
      "playbackId" => stream.playback_id,
      "enabled" => true,
      "visibility" => "private",
      "ownerId" => owner.id,
      "sharedWith" => [],
    )
    expect(body["settings"]).to eq({ "publicViewing" => false })
  end

  it "returns every relay destination with its real (unmasked) key" do
    relay = stream.relay_destinations.create!(provider: "twitch", key: "real-key-value")
    get "/internal/test-internal-secret/streams", as: :json
    body = JSON.parse(response.body)
    entry = body["relays"].find { |r| r["id"] == relay.id }
    expect(entry).to include("streamId" => stream.id, "provider" => "twitch", "key" => "real-key-value", "enabled" => true)
  end

  it "reflects publicViewing once set" do
    AppSetting.instance.update!(public_viewing: true)
    get "/internal/test-internal-secret/streams", as: :json
    expect(JSON.parse(response.body)["settings"]["publicViewing"]).to be true
  end
end
