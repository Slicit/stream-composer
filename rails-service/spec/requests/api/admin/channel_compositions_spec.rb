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

    it "refuses a signed-in viewer, even without can_use_compositor mattering here" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/channels/#{channel.id}/compositions", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "manages compositions for a channel it does not own, whether or not the owner has compositor access" do
      expect(owner.can_use_compositor).to eq(false)
      patch "/api/admin/channels/#{channel.id}/compositions/horizontal", params: { enabled: true }, as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["composition"]["enabled"]).to eq(true)
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
