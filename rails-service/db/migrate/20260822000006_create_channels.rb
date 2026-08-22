class CreateChannels < ActiveRecord::Migration[8.1]
  def change
    create_table :channels, id: :uuid do |t|
      t.string :name, null: false
      t.string :slug, null: false
      t.string :visibility, null: false, default: "private"
      t.references :owner, type: :uuid, null: false, foreign_key: { to_table: :users, on_delete: :cascade }
      t.string :background_image, null: false, default: ""
      # Ordered — defines both membership and layout order, same as
      # channels.js. A Postgres array for the same reason streams.shared_with
      # is one: this is what keeps the config.json migration a field copy.
      t.uuid :stream_ids, array: true, null: false, default: []
      t.uuid :shared_with, array: true, null: false, default: []

      t.timestamps
    end

    add_index :channels, "lower(slug)", unique: true, name: "index_channels_on_lower_slug"
    add_index :channels, :stream_ids, using: :gin
    add_index :channels, :shared_with, using: :gin
    add_check_constraint :channels, "visibility IN ('public', 'private')", name: "channels_visibility_check"
  end
end
