# Nullable, no default: a user who never picked a theme has no server
# opinion, and the client falls back to its own default rather than this
# column needing to duplicate that choice. See User::THEMES.
class AddThemeToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :theme, :string
  end
end
