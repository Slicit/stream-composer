class AddDescriptionTopicAndGameToChannels < ActiveRecord::Migration[8.1]
  def change
    add_column :channels, :description, :string, limit: 500, null: false, default: ""
    add_column :channels, :current_topic, :string, limit: 255, null: false, default: ""
    add_reference :channels, :featured_game, type: :uuid, null: true, foreign_key: { to_table: :games, on_delete: :nullify }
  end
end
