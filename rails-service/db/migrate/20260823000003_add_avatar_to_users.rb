class AddAvatarToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :avatar, :string, null: false, default: ""
  end
end
