# One-shot import of the legacy Node backend's config.json into Postgres.
# "No fuzz required" (the user's own words) — this is a straight field
# copy, not a reconciliation tool. Run it once, against a stopped Node
# backend so config.json is not being written concurrently, then switch
# traffic to Rails.
#
#   bin/rails migrate_from_json[/path/to/config.json]
#
# Idempotent-ish: re-running against the same file updates existing rows
# (matched by id) rather than duplicating them, so a failed partial run can
# just be re-run.
namespace :migrate_from_json do
  desc "Import users, streams, restream destinations and channels from the legacy config.json"
  task :run, [:path] => :environment do |_t, args|
    path = args[:path] || ENV["CONFIG_JSON_PATH"]
    abort "Usage: bin/rails migrate_from_json:run[/path/to/config.json]" if path.blank?

    data = JSON.parse(File.read(path))

    user_count = 0
    ActiveRecord::Base.transaction do
      (data["users"] || []).each do |u|
        User.import_legacy!(
          id: u["id"],
          username: u["username"],
          role: u["role"],
          stream_quota: u["streamQuota"] || 0,
          salt: u["salt"],
          password_hash: u["hash"],
          created_at: u["createdAt"],
          last_login_at: u["lastLoginAt"],
        )
        user_count += 1
      end
    end
    puts "Imported #{user_count} user(s)."

    stream_count = 0
    ActiveRecord::Base.transaction do
      (data["streams"] || []).each do |s|
        stream = Stream.find_or_initialize_by(id: s["id"])
        stream.assign_attributes(
          name: s["name"],
          nickname: s["nickname"] || "",
          key: s["key"],
          playback_id: s["playbackId"],
          enabled: s.fetch("enabled", true),
          note: s["note"] || "",
          visibility: s["visibility"] || "private",
          owner_id: s["ownerId"].presence,
          shared_with: s["sharedWith"] || [],
        )
        stream.created_at = s["createdAt"] if s["createdAt"] && stream.new_record?
        stream.save!
        stream_count += 1
      end
    end
    puts "Imported #{stream_count} stream(s)."

    relay_count = 0
    ActiveRecord::Base.transaction do
      (data["relays"] || []).each do |r|
        relay = RelayDestination.find_or_initialize_by(id: r["id"])
        relay.assign_attributes(
          stream_id: r["streamId"],
          provider: r["provider"],
          name: r["name"],
          url: r["url"],
          key: r["key"] || "",
          audio: r["audio"] || "copy",
          enabled: r.fetch("enabled", true),
        )
        relay.created_at = r["createdAt"] if r["createdAt"] && relay.new_record?
        relay.save!
        relay_count += 1
      end
    end
    puts "Imported #{relay_count} restream destination(s)."

    channel_count = 0
    ActiveRecord::Base.transaction do
      (data["channels"] || []).each do |c|
        channel = Channel.find_or_initialize_by(id: c["id"])
        channel.assign_attributes(
          name: c["name"],
          slug: c["slug"],
          visibility: c["visibility"] || "private",
          owner_id: c["ownerId"],
          background_image: c["backgroundImage"] || "",
          stream_ids: c["streamIds"] || [],
          shared_with: c["sharedWith"] || [],
        )
        channel.created_at = c["createdAt"] if c["createdAt"] && channel.new_record?
        channel.save!
        channel_count += 1
      end
    end
    puts "Imported #{channel_count} channel(s)."

    homepage_id = data.dig("settings", "homepageChannelId")
    if homepage_id.present?
      AppSetting.instance.update!(homepage_channel_id: homepage_id)
      puts "Set the homepage channel."
    end
  end
end
