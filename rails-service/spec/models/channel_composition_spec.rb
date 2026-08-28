require "rails_helper"

RSpec.describe ChannelComposition, type: :model do
  let!(:owner) { User.create!(username: "owner-1", password: "correct-horse-1", role: "streamer") }
  let!(:channel) { Channel.create!(name: "Test Channel", owner: owner) }

  def build_composition(**attrs)
    ChannelComposition.new({ channel: channel, orientation: "horizontal" }.merge(attrs))
  end

  it "defaults to disabled, auto encoder and the veryfast preset" do
    composition = build_composition.tap(&:save!)
    expect(composition.enabled).to eq(false)
    expect(composition.encoder).to eq("auto")
    expect(composition.preset).to eq("veryfast")
  end

  it "rejects an unknown orientation" do
    expect(build_composition(orientation: "diagonal")).not_to be_valid
  end

  it "allows only one composition per (channel, orientation)" do
    build_composition.save!
    expect(build_composition).not_to be_valid
  end

  it "allows both orientations on the same channel" do
    build_composition.save!
    expect(build_composition(orientation: "vertical")).to be_valid
  end

  it "rejects a width above the sane ceiling" do
    expect(build_composition(width: 5000)).not_to be_valid
  end

  it "rejects a non-hex background color" do
    expect(build_composition(background_color: "blue")).not_to be_valid
  end

  it "accepts a real hex background color" do
    expect(build_composition(background_color: "#112233")).to be_valid
  end

  describe "#as_public_json" do
    it "includes its nested destinations" do
      composition = build_composition.tap(&:save!)
      composition.channel_relay_destinations.create!(provider: "custom", url: "rtmp://example.test/live")
      expect(composition.as_public_json[:destinations].length).to eq(1)
    end
  end
end
