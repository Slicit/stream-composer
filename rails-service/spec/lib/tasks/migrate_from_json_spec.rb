require "rails_helper"
require "rake"

RSpec.describe "migrate_from_json:run" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("migrate_from_json:run")
  end

  after { Rake::Task["migrate_from_json:run"].reenable }

  let(:user_id) { SecureRandom.uuid }
  let(:stream_id) { SecureRandom.uuid }
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
    }.to_json)
    path
  end

  it "imports the user with a password that still authenticates, and the stream with its ownership intact" do
    Rake::Task["migrate_from_json:run"].invoke(config_path.to_s)

    user = User.find(user_id)
    expect(user.username).to eq("legacy-admin")
    expect(user.role).to eq("admin")
    expect(User.authenticate_credentials("legacy-admin", "original-password-1")).to eq(user)

    stream = Stream.find(stream_id)
    expect(stream.name).to eq("Legacy Camera")
    expect(stream.key).to eq("legacy-key-000000")
    expect(stream.owner_id).to eq(user_id)
    expect(stream.visibility).to eq("public")
  end

  it "is safe to re-run against the same file" do
    Rake::Task["migrate_from_json:run"].invoke(config_path.to_s)
    Rake::Task["migrate_from_json:run"].reenable
    Rake::Task["migrate_from_json:run"].invoke(config_path.to_s)

    expect(User.where(id: user_id).count).to eq(1)
    expect(Stream.where(id: stream_id).count).to eq(1)
  end
end
