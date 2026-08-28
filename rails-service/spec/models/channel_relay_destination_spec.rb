require "rails_helper"

RSpec.describe ChannelRelayDestination, type: :model do
  let!(:owner) { User.create!(username: "owner-1", password: "correct-horse-1", role: "streamer") }
  let!(:channel) { Channel.create!(name: "Test Channel", owner: owner) }
  let!(:composition) { ChannelComposition.create!(channel: channel, orientation: "horizontal") }

  def build_destination(**attrs)
    ChannelRelayDestination.new({ channel_composition: composition, provider: "twitch" }.merge(attrs))
  end

  # The shared RelayDestinationLike behavior (provider defaults, URL/key
  # validation) already has full coverage in relay_destination_spec.rb —
  # these just confirm the concern actually applies here too.
  it "fills in the provider's default URL when none is given" do
    destination = build_destination.tap(&:save!)
    expect(destination.url).to eq("rtmp://live.twitch.tv/app")
  end

  it "rejects a non-rtmp URL" do
    expect(build_destination(provider: "custom", url: "https://example.test/live")).not_to be_valid
  end

  it "has a tiktok preset with no default URL, since TikTok issues one per session" do
    preset = ChannelRelayDestination.provider_by_id("tiktok")
    expect(preset[:url]).to eq("")
  end

  it "refuses a 9th destination on the same composition" do
    8.times { composition.channel_relay_destinations.create!(provider: "custom", url: "rtmp://example.test/live") }
    expect(build_destination(provider: "custom", url: "rtmp://example.test/live")).not_to be_valid
  end

  it "does not count destinations on a different composition toward the cap" do
    other = ChannelComposition.create!(channel: channel, orientation: "vertical")
    8.times { other.channel_relay_destinations.create!(provider: "custom", url: "rtmp://example.test/live") }
    expect(build_destination(provider: "custom", url: "rtmp://example.test/live")).to be_valid
  end
end
