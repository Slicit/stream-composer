require "rails_helper"

RSpec.describe "Api::Games", type: :request do
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  it "lists games alphabetically for any signed-in user" do
    Game.create!(name: "Zelda")
    Game.create!(name: "Apex Legends")
    sign_in_as(viewer, password: "correct-horse-1")

    get "/api/games", as: :json
    expect(response).to have_http_status(:ok)
    names = JSON.parse(response.body)["games"].map { |g| g["name"] }
    expect(names).to eq(["Apex Legends", "Zelda"])
  end

  it "refuses an anonymous caller" do
    get "/api/games", as: :json
    expect(response).to have_http_status(:unauthorized)
  end
end
