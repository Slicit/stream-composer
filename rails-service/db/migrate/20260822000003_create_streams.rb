class CreateStreams < ActiveRecord::Migration[8.1]
  def change
    create_table :streams, id: :uuid do |t|
      t.string :name, null: false
      t.string :nickname, null: false, default: ""
      t.string :key, null: false
      t.string :playback_id, null: false
      t.boolean :enabled, null: false, default: true
      t.text :note, null: false, default: ""
      t.string :visibility, null: false, default: "private"
      # Nullable: an admin-managed stream has no owner, same as the Node
      # backend's ownerId defaulting to null.
      t.references :owner, type: :uuid, foreign_key: { to_table: :users, on_delete: :nullify }
      # Explicit access grants for a private stream, when it is not
      # already the owner or an admin looking. A Postgres array rather
      # than a join table for now — deliberately the simplest shape that
      # matches the JSON it is migrated from; see Decisions if this ever
      # needs proper referential integrity per entry.
      t.uuid :shared_with, array: true, null: false, default: []

      t.timestamps
    end

    add_index :streams, :key, unique: true
    add_index :streams, :playback_id, unique: true
    add_index :streams, :shared_with, using: :gin

    add_check_constraint :streams, "visibility IN ('public', 'private')", name: "streams_visibility_check"
  end
end
