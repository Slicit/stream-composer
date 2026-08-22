require "rails_helper"
require "rake"

RSpec.describe "migrate_from_json:run" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("migrate_from_json:run")
  end

  after { Rake::Task["migrate_from_json:run"].reenable }

  let(:user_id) { SecureRandom.uuid }
  let(:stream_id) { SecureRandom.uuid }
  let(:relay_id) { SecureRandom.uuid }
  let(:channel_id) { SecureRandom.uuid }
  let(:legacy_hash) { User.scrypt_hex("original-password-1", "legacy-salt-value") }

  let(:config_path) do
    path = Rails.root.join("tmp", "migrate_from_json_spec.json")
    File.write(path, {
      users: [{
        id: user_id, username: "legacy-admin", role: "admin", streamQuota: 0,
        salt: "legacy-salt-value", hash: legacy_hash,
        createdAt: "2024-01-01T00:00:00.000Z", lastLoginAt: nil,
      }],
      streams: [{
        id: stream_id, name: "Legacy Camera", nickname: "", key: "legacy-key-000000",
        playbackId: "legacyplaybackid0", enabled: true, note: "", visibility: "public",
        ownerId: user_id, sharedWith: [],
      }],
      relays: [{
        id: relay_id, streamId: stream_id, provider: "twitch", name: "Twitch",
        url: "rtmp://live.twitch.tv/app", key: "legacy-relay-key", audio: "copy",
        enabled: true, createdAt: "2024-01-02T00:00:00.000Z",
      }],
      channels: [{
        id: channel_id, name: "Legacy Channel", slug: "legacy-channel", visibility: "public",
        ownerId: user_id, backgroundImage: "", streamIds: [stream_id], sharedWith: [],
        createdAt: "2024-01-03T00:00:00.000Z",
      }],
      settings: { homepageChannelId: channel_id },
    }.to_json)
    path
  end

  it "imports users, streams, relay destinations and channels, with relationships intact" do
    Rake::Task["migrate_from_json:run"].invoke(config_path.to_s)

    user = User.find(user_id)
    expect(User.authenticate_credentials("legacy-admin", "original-password-1")).to eq(user)

    stream = Stream.find(stream_id)
    expect(stream.owner_id).to eq(user_id)

    relay = RelayDestination.find(relay_id)
    expect(relay.stream_id).to eq(stream_id)
    expect(relay.key).to eq("legacy-relay-key")

    channel = Channel.find(channel_id)
    expect(channel.slug).to eq("legacy-channel")
    expect(channel.stream_ids).to eq([stream_id])
    expect(channel.owner_id).to eq(user_id)

    expect(AppSetting.instance.homepage_channel_id).to eq(channel_id)
  end

  it "is safe to re-run against the same file" do
    Rake::Task["migrate_from_json:run"].invoke(config_path.to_s)
    Rake::Task["migrate_from_json:run"].reenable
    Rake::Task["migrate_from_json:run"].invoke(config_path.to_s)

    expect(User.where(id: user_id).count).to eq(1)
    expect(Stream.where(id: stream_id).count).to eq(1)
    expect(RelayDestination.where(id: relay_id).count).to eq(1)
    expect(Channel.where(id: channel_id).count).to eq(1)
  end
end
