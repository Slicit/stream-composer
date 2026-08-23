class CreateGames < ActiveRecord::Migration[8.1]
  def change
    create_table :games, id: :uuid do |t|
      t.string :name, null: false

      t.timestamps
    end

    add_index :games, "lower(name)", unique: true, name: "index_games_on_lower_name"
  end
end
