class CreateRelayDestinations < ActiveRecord::Migration[8.1]
  def change
    create_table :relay_destinations, id: :uuid do |t|
      t.references :stream, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.string :provider, null: false, default: "custom"
      t.string :name, null: false
      t.string :url, null: false
      # The third-party platform's stream key — a publishing credential for
      # somebody else's channel. Never rendered in full to the client; see
      # RelayDestination#key_masked. Empty string, not null, when the whole
      # address already carried it in the URL.
      t.string :key, null: false, default: ""
      t.string :audio, null: false, default: "copy"
      t.boolean :enabled, null: false, default: true

      t.timestamps
    end

    add_check_constraint :relay_destinations, "audio IN ('copy', 'aac')", name: "relay_destinations_audio_check"
  end
end
