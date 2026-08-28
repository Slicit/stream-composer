class CreateChannelRelayDestinations < ActiveRecord::Migration[8.1]
  def change
    # Forwarding a channel's *composed* output on to a platform, as opposed
    # to relay_destinations which forwards one raw source. No audio column:
    # the composited program is a single already-encoded feed by the time
    # it reaches a destination (go-service/internal/relayrunner does a
    # straight -c:v copy remux, same as it already does for stream relays),
    # so there is nothing per-destination to choose.
    create_table :channel_relay_destinations, id: :uuid do |t|
      t.references :channel_composition, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.string :provider, null: false, default: "custom"
      t.string :name, null: false
      t.string :url, null: false
      t.string :key, null: false, default: ""
      t.boolean :enabled, null: false, default: true

      t.timestamps
    end
  end
end
