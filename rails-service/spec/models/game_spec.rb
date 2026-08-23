require "rails_helper"

RSpec.describe Game, type: :model do
  it "strips surrounding whitespace from the name" do
    game = Game.create!(name: "  Celeste  ")
    expect(game.name).to eq("Celeste")
  end

  it "rejects a blank name" do
    expect(Game.new(name: "  ")).not_to be_valid
  end

  it "rejects a duplicate name case-insensitively" do
    Game.create!(name: "Hades II")
    expect(Game.new(name: "hades ii")).not_to be_valid
  end

  it "serializes just id and name" do
    game = Game.create!(name: "Balatro")
    expect(game.as_public_json).to eq({ id: game.id, name: "Balatro" })
  end
end
