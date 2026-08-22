require "rails_helper"

RSpec.describe RelayDestination, type: :model do
  let!(:stream) { Stream.create!(name: "Camera 1") }

  def build_relay(**attrs)
    RelayDestination.new({ stream: stream, provider: "twitch" }.merge(attrs))
  end

  describe "provider defaults" do
    it "fills in the provider's default URL when none is given" do
      relay = build_relay.tap(&:save!)
      expect(relay.url).to eq("rtmp://live.twitch.tv/app")
    end

    it "falls back to custom for an unrecognized provider" do
      relay = build_relay(provider: "not-a-real-platform", url: "rtmp://example.test/live").tap(&:save!)
      expect(relay.provider).to eq("custom")
    end

    it "names itself after the provider label when no name is given" do
      relay = build_relay.tap(&:save!)
      expect(relay.name).to eq("Twitch")
    end

    it "names a custom destination after the URL's host when no name is given" do
      relay = build_relay(provider: "custom", url: "rtmp://example.test/live").tap(&:save!)
      expect(relay.name).to eq("example.test")
    end
  end

  describe "URL validation" do
    it "requires a URL" do
      expect(build_relay(provider: "custom", url: "")).not_to be_valid
    end

    it "rejects a non-rtmp scheme" do
      expect(build_relay(url: "https://example.test/live")).not_to be_valid
    end

    it "rejects a URL containing whitespace" do
      relay = build_relay
      relay.url = "rtmp://example.test/li ve"
      expect(relay).not_to be_valid
    end

    it "accepts rtmps" do
      expect(build_relay(url: "rtmps://example.test/live")).to be_valid
    end
  end

  describe "key validation" do
    it "allows a blank key" do
      expect(build_relay(key: "")).to be_valid
    end

    it "rejects a key with a space" do
      expect(build_relay(key: "has space")).not_to be_valid
    end

    it "rejects a key that is too long" do
      expect(build_relay(key: "x" * 257)).not_to be_valid
    end
  end

  describe "#key_masked" do
    it "masks a long key, keeping only the first and last three characters" do
      expect(RelayDestination.mask_key("live_abcdefghij_1234")).to eq("liv••••••234")
    end

    it "fully masks a short key" do
      expect(RelayDestination.mask_key("short")).to eq("•••••")
    end

    it "is blank for a blank key" do
      expect(RelayDestination.mask_key("")).to eq("")
    end
  end

  describe ".destination_url" do
    it "appends the key as the final path segment" do
      expect(RelayDestination.destination_url("rtmp://live.twitch.tv/app", "my-key")).to eq("rtmp://live.twitch.tv/app/my-key")
    end

    it "keeps the query string after the key, not before it" do
      expect(RelayDestination.destination_url("rtmp://b.rtmp.youtube.com/live2?backup=1", "my-key"))
        .to eq("rtmp://b.rtmp.youtube.com/live2/my-key?backup=1")
    end

    it "returns the bare URL when there is no key" do
      expect(RelayDestination.destination_url("rtmp://example.test/live/already-keyed", "")).to eq("rtmp://example.test/live/already-keyed")
    end
  end

  it "refuses a 65th destination" do
    64.times { |i| Stream.create!(name: "s#{i}").relay_destinations.create!(provider: "custom", url: "rtmp://example.test/live") }
    expect(build_relay(provider: "custom", url: "rtmp://example.test/live")).not_to be_valid
  end
end
