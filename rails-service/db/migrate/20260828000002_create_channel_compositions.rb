class CreateChannelCompositions < ActiveRecord::Migration[8.1]
  def change
    # One row per (channel, orientation) — a channel opts each orientation
    # in independently. This table is config only: the Go data plane reads
    # it (via Internal::CompositionsController) to decide what to run, and
    # never writes to it. See go-service/internal/layout for the grid math
    # and the (not yet ported) compositor service for the ffmpeg side.
    create_table :channel_compositions, id: :uuid do |t|
      t.references :channel, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.string :orientation, null: false
      t.boolean :enabled, null: false, default: false
      t.integer :width, null: false, default: 1920
      t.integer :height, null: false, default: 1080
      t.integer :fps, null: false, default: 30
      t.integer :bitrate_kbps, null: false, default: 4500
      # ffmpeg's libx264 speed preset (ultrafast..veryslow) — only meaningful
      # for the software encoder path; ignored when a hardware encoder is
      # resolved. See server/src/compositor.js's buildArgs for precedent.
      t.string :preset, null: false, default: "veryfast"
      t.string :encoder, null: false, default: "auto"
      t.string :background_color, null: false, default: "#0b1220"
      t.boolean :labels, null: false, default: true
      t.integer :label_size, null: false, default: 22

      t.timestamps
    end

    add_check_constraint :channel_compositions, "orientation IN ('horizontal', 'vertical')", name: "channel_compositions_orientation_check"
    add_check_constraint :channel_compositions, "encoder IN ('auto', 'software', 'vaapi', 'qsv')", name: "channel_compositions_encoder_check"
    add_check_constraint :channel_compositions, "width > 0 AND width <= 3840", name: "channel_compositions_width_check"
    add_check_constraint :channel_compositions, "height > 0 AND height <= 3840", name: "channel_compositions_height_check"
    add_check_constraint :channel_compositions, "bitrate_kbps > 0 AND bitrate_kbps <= 51000", name: "channel_compositions_bitrate_check"
    add_index :channel_compositions, %i[channel_id orientation], unique: true
  end
end
