class AddPreviewTokenToChannelCompositions < ActiveRecord::Migration[8.1]
  def up
    add_column :channel_compositions, :preview_token, :string
    ChannelComposition.reset_column_information
    ChannelComposition.find_each { |cc| cc.update_column(:preview_token, SecureRandom.hex(16)) }
    change_column_null :channel_compositions, :preview_token, false
    add_index :channel_compositions, :preview_token, unique: true
  end

  def down
    remove_index :channel_compositions, :preview_token
    remove_column :channel_compositions, :preview_token
  end
end
