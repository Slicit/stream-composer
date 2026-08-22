class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users, id: :uuid do |t|
      t.string :username, null: false
      t.string :role, null: false, default: "viewer"
      # How many streams this account may register through self-service
      # (see Stream ownership). Zero by default: a streamer account is only
      # useful once an admin explicitly grants it a quota.
      t.integer :stream_quota, null: false, default: 0
      t.string :salt, null: false
      t.string :password_hash, null: false
      t.datetime :last_login_at
      t.datetime :password_changed_at

      t.timestamps
    end

    # Case-insensitive uniqueness — "Admin" and "admin" are the same
    # account, matching the Node backend's findByUsername().
    add_index :users, "lower(username)", unique: true, name: "index_users_on_lower_username"

    add_check_constraint :users, "role IN ('admin', 'viewer', 'streamer')", name: "users_role_check"
    add_check_constraint :users, "stream_quota >= 0 AND stream_quota <= 1000", name: "users_stream_quota_range"
  end
end
