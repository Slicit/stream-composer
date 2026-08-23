require "rails_helper"

RSpec.describe "Api::Admin::Games", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  describe "SECURITY: access control" do
    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/games", as: :json
      expect(response).to have_http_status(:forbidden)
    end

    it "refuses an anonymous caller" do
      get "/api/admin/games", as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "lists games alphabetically" do
      Game.create!(name: "Zelda")
      Game.create!(name: "Apex Legends")
      get "/api/admin/games", as: :json
      expect(JSON.parse(response.body)["games"].map { |g| g["name"] }).to eq(["Apex Legends", "Zelda"])
    end

    it "creates a game" do
      post "/api/admin/games", params: { name: "Celeste" }, as: :json
      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["game"]["name"]).to eq("Celeste")
    end

    it "rejects a duplicate name" do
      Game.create!(name: "Celeste")
      post "/api/admin/games", params: { name: "celeste" }, as: :json
      expect(response).to have_http_status(:bad_request)
    end

    it "renames a game" do
      game = Game.create!(name: "Old Name")
      patch "/api/admin/games/#{game.id}", params: { name: "New Name" }, as: :json
      expect(response).to have_http_status(:ok)
      expect(game.reload.name).to eq("New Name")
    end

    it "deletes a game and clears it from any channel that featured it" do
      game = Game.create!(name: "Doomed Game")
      owner = User.create!(username: "owner-1", password: "correct-horse-1", role: "viewer")
      channel = owner.owned_channels.create!(name: "Room", featured_game: game)

      delete "/api/admin/games/#{game.id}", as: :json
      expect(response).to have_http_status(:ok)
      expect(Game.exists?(game.id)).to be false
      expect(channel.reload.featured_game_id).to be_nil
    end
  end
end
