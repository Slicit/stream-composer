# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_08_29_000005) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"
  enable_extension "pgcrypto"

  create_table "app_settings", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "default_layout_mode", default: "fixed", null: false
    t.uuid "homepage_channel_id"
    t.boolean "public_viewing", default: false, null: false
    t.datetime "updated_at", null: false
    t.check_constraint "default_layout_mode::text = ANY (ARRAY['fixed'::character varying::text, 'maximize'::character varying::text])", name: "app_settings_default_layout_mode_check"
  end

  create_table "channel_compositions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "background_color", default: "#0b1220", null: false
    t.integer "bitrate_kbps", default: 4500, null: false
    t.uuid "channel_id", null: false
    t.datetime "created_at", null: false
    t.boolean "enabled", default: false, null: false
    t.string "encoder", default: "auto", null: false
    t.integer "fps", default: 30, null: false
    t.integer "height", default: 1080, null: false
    t.integer "label_size", default: 22, null: false
    t.boolean "labels", default: true, null: false
    t.string "orientation", null: false
    t.string "preset", default: "veryfast", null: false
    t.string "preview_token", null: false
    t.datetime "updated_at", null: false
    t.integer "width", default: 1920, null: false
    t.index ["channel_id", "orientation"], name: "index_channel_compositions_on_channel_id_and_orientation", unique: true
    t.index ["channel_id"], name: "index_channel_compositions_on_channel_id"
    t.index ["preview_token"], name: "index_channel_compositions_on_preview_token", unique: true
    t.check_constraint "bitrate_kbps > 0 AND bitrate_kbps <= 51000", name: "channel_compositions_bitrate_check"
    t.check_constraint "encoder::text = ANY (ARRAY['auto'::character varying::text, 'software'::character varying::text, 'vaapi'::character varying::text, 'qsv'::character varying::text])", name: "channel_compositions_encoder_check"
    t.check_constraint "height > 0 AND height <= 3840", name: "channel_compositions_height_check"
    t.check_constraint "orientation::text = ANY (ARRAY['horizontal'::character varying::text, 'vertical'::character varying::text])", name: "channel_compositions_orientation_check"
    t.check_constraint "width > 0 AND width <= 3840", name: "channel_compositions_width_check"
  end

  create_table "channel_relay_destinations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "channel_composition_id", null: false
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true, null: false
    t.string "key", default: "", null: false
    t.string "name", null: false
    t.string "provider", default: "custom", null: false
    t.datetime "updated_at", null: false
    t.string "url", null: false
    t.index ["channel_composition_id"], name: "index_channel_relay_destinations_on_channel_composition_id"
  end

  create_table "channels", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "background_image", default: "", null: false
    t.datetime "created_at", null: false
    t.string "current_topic", limit: 255, default: "", null: false
    t.string "description", limit: 500, default: "", null: false
    t.uuid "featured_game_id"
    t.string "layout_mode"
    t.string "name", null: false
    t.uuid "owner_id", null: false
    t.uuid "shared_with", default: [], null: false, array: true
    t.string "slug", null: false
    t.uuid "stream_ids", default: [], null: false, array: true
    t.datetime "updated_at", null: false
    t.string "visibility", default: "private", null: false
    t.index "lower((slug)::text)", name: "index_channels_on_lower_slug", unique: true
    t.index ["featured_game_id"], name: "index_channels_on_featured_game_id"
    t.index ["owner_id"], name: "index_channels_on_owner_id"
    t.index ["shared_with"], name: "index_channels_on_shared_with", using: :gin
    t.index ["stream_ids"], name: "index_channels_on_stream_ids", using: :gin
    t.check_constraint "layout_mode::text = ANY (ARRAY['fixed'::character varying::text, 'maximize'::character varying::text])", name: "channels_layout_mode_check"
    t.check_constraint "visibility::text = ANY (ARRAY['public'::character varying::text, 'private'::character varying::text])", name: "channels_visibility_check"
  end

  create_table "games", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.datetime "updated_at", null: false
    t.index "lower((name)::text)", name: "index_games_on_lower_name", unique: true
  end

  create_table "relay_destinations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "audio", default: "copy", null: false
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true, null: false
    t.string "key", default: "", null: false
    t.string "name", null: false
    t.string "provider", default: "custom", null: false
    t.uuid "stream_id", null: false
    t.datetime "updated_at", null: false
    t.string "url", null: false
    t.index ["stream_id"], name: "index_relay_destinations_on_stream_id"
    t.check_constraint "audio::text = ANY (ARRAY['copy'::character varying::text, 'aac'::character varying::text])", name: "relay_destinations_audio_check"
  end

  create_table "sessions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.uuid "impersonator_id"
    t.string "token_digest", null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
    t.index ["impersonator_id"], name: "index_sessions_on_impersonator_id"
    t.index ["token_digest"], name: "index_sessions_on_token_digest", unique: true
    t.index ["user_id"], name: "index_sessions_on_user_id"
  end

  create_table "streams", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true, null: false
    t.string "key", null: false
    t.string "name", null: false
    t.string "nickname", default: "", null: false
    t.text "note", default: "", null: false
    t.uuid "owner_id"
    t.string "playback_id", null: false
    t.uuid "shared_with", default: [], null: false, array: true
    t.datetime "updated_at", null: false
    t.string "visibility", default: "private", null: false
    t.index ["key"], name: "index_streams_on_key", unique: true
    t.index ["owner_id"], name: "index_streams_on_owner_id"
    t.index ["playback_id"], name: "index_streams_on_playback_id", unique: true
    t.index ["shared_with"], name: "index_streams_on_shared_with", using: :gin
    t.check_constraint "visibility::text = ANY (ARRAY['public'::character varying::text, 'private'::character varying::text])", name: "streams_visibility_check"
  end

  create_table "two_factor_challenges", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "token_digest", null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
    t.index ["token_digest"], name: "index_two_factor_challenges_on_token_digest", unique: true
    t.index ["user_id"], name: "index_two_factor_challenges_on_user_id"
  end

  create_table "users", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "avatar", default: "", null: false
    t.integer "compositor_quota", default: 0, null: false
    t.datetime "confirmation_sent_at"
    t.string "confirmation_token_digest"
    t.datetime "created_at", null: false
    t.string "email"
    t.datetime "email_confirmed_at"
    t.datetime "last_login_at"
    t.string "otp_backup_code_digests", default: [], null: false, array: true
    t.boolean "otp_enabled", default: false, null: false
    t.string "otp_secret"
    t.datetime "password_changed_at"
    t.string "password_hash", null: false
    t.string "role", default: "viewer", null: false
    t.string "salt", null: false
    t.integer "stream_quota", default: 0, null: false
    t.datetime "updated_at", null: false
    t.string "username", null: false
    t.index "lower((email)::text)", name: "index_users_on_lower_email", unique: true, where: "(email IS NOT NULL)"
    t.index "lower((username)::text)", name: "index_users_on_lower_username", unique: true
    t.check_constraint "compositor_quota >= 0 AND compositor_quota <= 20", name: "users_compositor_quota_range"
    t.check_constraint "role::text = ANY (ARRAY['admin'::character varying::text, 'viewer'::character varying::text, 'streamer'::character varying::text])", name: "users_role_check"
    t.check_constraint "stream_quota >= 0 AND stream_quota <= 1000", name: "users_stream_quota_range"
  end

  add_foreign_key "channel_compositions", "channels", on_delete: :cascade
  add_foreign_key "channel_relay_destinations", "channel_compositions", on_delete: :cascade
  add_foreign_key "channels", "games", column: "featured_game_id", on_delete: :nullify
  add_foreign_key "channels", "users", column: "owner_id", on_delete: :cascade
  add_foreign_key "relay_destinations", "streams", on_delete: :cascade
  add_foreign_key "sessions", "users"
  add_foreign_key "sessions", "users", column: "impersonator_id", on_delete: :nullify
  add_foreign_key "streams", "users", column: "owner_id", on_delete: :nullify
  add_foreign_key "two_factor_challenges", "users"
end
