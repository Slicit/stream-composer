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

ActiveRecord::Schema[8.1].define(version: 2026_08_22_000005) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"
  enable_extension "pgcrypto"

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
    t.check_constraint "audio::text = ANY (ARRAY['copy'::character varying, 'aac'::character varying]::text[])", name: "relay_destinations_audio_check"
  end

  create_table "sessions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "expires_at", null: false
    t.string "token_digest", null: false
    t.datetime "updated_at", null: false
    t.uuid "user_id", null: false
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

  create_table "users", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "last_login_at"
    t.datetime "password_changed_at"
    t.string "password_hash", null: false
    t.string "role", default: "viewer", null: false
    t.string "salt", null: false
    t.integer "stream_quota", default: 0, null: false
    t.datetime "updated_at", null: false
    t.string "username", null: false
    t.index "lower((username)::text)", name: "index_users_on_lower_username", unique: true
    t.check_constraint "role::text = ANY (ARRAY['admin'::character varying::text, 'viewer'::character varying::text, 'streamer'::character varying::text])", name: "users_role_check"
    t.check_constraint "stream_quota >= 0 AND stream_quota <= 1000", name: "users_stream_quota_range"
  end

  add_foreign_key "relay_destinations", "streams", on_delete: :cascade
  add_foreign_key "sessions", "users"
  add_foreign_key "streams", "users", column: "owner_id", on_delete: :nullify
end
