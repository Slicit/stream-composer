class AddLayoutModeToChannels < ActiveRecord::Migration[8.1]
  def change
    # Null means "inherit the site default" — not the same as "fixed",
    # which is a channel explicitly pinning that mode even if the default
    # later changes. See Channel#layout_mode and AppSetting#default_layout_mode.
    add_column :channels, :layout_mode, :string, null: true
    add_check_constraint :channels, "layout_mode IN ('fixed', 'maximize')", name: "channels_layout_mode_check"
  end
end
