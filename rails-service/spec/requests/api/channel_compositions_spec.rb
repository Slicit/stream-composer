require "rails_helper"

RSpec.describe "Api::ChannelCompositions (self-service /channels/mine/:channel_id/compositions)", type: :request do
  let!(:granted) { User.create!(username: "granted-1", password: "correct-horse-1", role: "streamer", compositor_quota: 2) }
  let!(:ungranted) { User.create!(username: "ungranted-1", password: "correct-horse-1", role: "streamer") }
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:channel) { granted.owned_channels.create!(name: "Granted's channel") }
  let!(:other_channel) { ungranted.owned_channels.create!(name: "Ungranted's channel") }

  describe "SECURITY: access control" do
    it "refuses a streamer with a zero compositor_quota" do
      sign_in_as(ungranted, password: "correct-horse-1")
      get "/api/channels/mine/#{other_channel.id}/compositions", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "an admin may act with a zero compositor_quota" do
      sign_in_as(admin, password: "correct-horse-1")
      get "/api/channels/mine/#{other_channel.id}/compositions", as: :json
      expect(response).to have_http_status(:ok)
    end

    it "SECURITY: refuses a granted streamer acting on someone else's channel" do
      sign_in_as(granted, password: "correct-horse-1")
      get "/api/channels/mine/#{other_channel.id}/compositions", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "index" do
    before { sign_in_as(granted, password: "correct-horse-1") }

    it "lazily creates both orientation rows, disabled by default" do
      get "/api/channels/mine/#{channel.id}/compositions", as: :json
      body = JSON.parse(response.body)
      orientations = body["compositions"].map { |c| c["orientation"] }
      expect(orientations).to contain_exactly("horizontal", "vertical")
      expect(body["compositions"].map { |c| c["enabled"] }).to all(eq(false))
    end

    it "includes the provider list" do
      get "/api/channels/mine/#{channel.id}/compositions", as: :json
      expect(JSON.parse(response.body)["providers"].map { |p| p["id"] }).to include("tiktok", "twitch", "youtube")
    end

    it "includes the caller's own quota" do
      get "/api/channels/mine/#{channel.id}/compositions", as: :json
      expect(JSON.parse(response.body)["quota"]).to eq(2)
    end

    it "includes a preview token per composition" do
      get "/api/channels/mine/#{channel.id}/compositions", as: :json
      tokens = JSON.parse(response.body)["compositions"].map { |c| c["previewToken"] }
      expect(tokens).to all(be_present)
      expect(tokens.uniq.length).to eq(2)
    end
  end

  describe "updating a composition" do
    before { sign_in_as(granted, password: "correct-horse-1") }

    it "enables it and applies the given settings" do
      patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { enabled: true, bitrateKbps: 6000 }, as: :json
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)["composition"]
      expect(body["enabled"]).to eq(true)
      expect(body["bitrateKbps"]).to eq(6000)
    end

    it "rejects an out-of-range bitrate" do
      patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { bitrateKbps: 999_999 }, as: :json
      expect(response).to have_http_status(:bad_request)
    end

    describe "SECURITY: quota enforcement" do
      it "refuses to enable a composition once the caller's quota is used up" do
        other_channel_of_granted = granted.owned_channels.create!(name: "Granted's second channel")

        patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
        expect(response).to have_http_status(:ok)
        patch "/api/channels/mine/#{channel.id}/compositions/vertical", params: { enabled: true }, as: :json
        expect(response).to have_http_status(:ok)

        # quota is 2, both already enabled — a third, on a different channel, must be refused.
        patch "/api/channels/mine/#{other_channel_of_granted.id}/compositions/horizontal", params: { enabled: true }, as: :json
        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)["error"]).to include("limit of 2")
        expect(ChannelComposition.find_by(channel: other_channel_of_granted, orientation: "horizontal").enabled).to eq(false)
      end

      it "does not count against the quota when re-saving an already-enabled composition" do
        patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
        patch "/api/channels/mine/#{channel.id}/compositions/vertical", params: { enabled: true }, as: :json

        # Both already enabled (using up the quota of 2) — changing an
        # unrelated field on one of them must not be refused.
        patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { enabled: true, bitrateKbps: 3000 }, as: :json
        expect(response).to have_http_status(:ok)
      end

      it "does not refuse disabling a composition, even at quota" do
        patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
        patch "/api/channels/mine/#{channel.id}/compositions/vertical", params: { enabled: true }, as: :json

        patch "/api/channels/mine/#{channel.id}/compositions/horizontal", params: { enabled: false }, as: :json
        expect(response).to have_http_status(:ok)
      end

      it "an admin acting via the self-service route is never quota-limited" do
        sign_in_as(admin, password: "correct-horse-1")
        admins_channel = admin.owned_channels.create!(name: "Admin's channel", stream_ids: [])
        3.times do |i|
          patch "/api/channels/mine/#{admins_channel.id}/compositions/#{i.even? ? 'horizontal' : 'vertical'}", params: { enabled: true }, as: :json
          expect(response).to have_http_status(:ok)
        end
      end
    end
  end

  describe "destinations" do
    before { sign_in_as(granted, password: "correct-horse-1") }

    it "creates a destination on the given orientation" do
      post "/api/channels/mine/#{channel.id}/compositions/vertical/destinations",
           params: { provider: "twitch", key: "a-key" }, as: :json
      expect(response).to have_http_status(:created)
      expect(ChannelComposition.find_by(channel: channel, orientation: "vertical").channel_relay_destinations.count).to eq(1)
    end

    it "toggles and deletes a destination" do
      post "/api/channels/mine/#{channel.id}/compositions/vertical/destinations",
           params: { provider: "custom", url: "rtmp://example.test/live" }, as: :json
      id = JSON.parse(response.body)["destination"]["id"]

      patch "/api/channels/mine/#{channel.id}/compositions/vertical/destinations/#{id}", params: { enabled: false }, as: :json
      expect(JSON.parse(response.body)["destination"]["enabled"]).to eq(false)

      delete "/api/channels/mine/#{channel.id}/compositions/vertical/destinations/#{id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(ChannelRelayDestination.exists?(id)).to be false
    end

    it "SECURITY: refuses to create a destination on someone else's channel" do
      post "/api/channels/mine/#{other_channel.id}/compositions/horizontal/destinations",
           params: { provider: "twitch", key: "a-key" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end
end
