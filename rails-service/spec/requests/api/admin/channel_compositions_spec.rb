require "rails_helper"

RSpec.describe "Api::Admin::ChannelCompositions", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }
  let!(:owner) { User.create!(username: "owner-1", password: "correct-horse-1", role: "streamer") }
  let!(:channel) { owner.owned_channels.create!(name: "Someone's channel") }

  describe "SECURITY: access control" do
    it "refuses an anonymous caller" do
      get "/api/admin/channels/#{channel.id}/compositions", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a signed-in viewer, even without compositor_quota mattering here" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/channels/#{channel.id}/compositions", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "manages compositions for a channel it does not own, whether or not the owner has any compositor quota" do
      expect(owner.compositor_quota).to eq(0)
      patch "/api/admin/channels/#{channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["composition"]["enabled"]).to eq(true)
    end

    it "is never quota-limited, even once the owner's own quota would be exhausted" do
      patch "/api/admin/channels/#{channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
      patch "/api/admin/channels/#{channel.id}/compositions/vertical", params: { enabled: true }, as: :json
      other_channel = owner.owned_channels.create!(name: "Someone's second channel")
      patch "/api/admin/channels/#{other_channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
      expect(response).to have_http_status(:ok)
    end

    it "manages a channel's composed-output relay destinations" do
      post "/api/admin/channels/#{channel.id}/compositions/horizontal/destinations",
           params: { provider: "youtube", key: "a-key" }, as: :json
      expect(response).to have_http_status(:created)
      id = JSON.parse(response.body)["destination"]["id"]

      delete "/api/admin/channels/#{channel.id}/compositions/horizontal/destinations/#{id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(ChannelRelayDestination.exists?(id)).to be false
    end
  end
end
