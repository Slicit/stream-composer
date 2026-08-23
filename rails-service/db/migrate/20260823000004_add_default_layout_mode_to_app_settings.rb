class AddDefaultLayoutModeToAppSettings < ActiveRecord::Migration[8.1]
  def change
    add_column :app_settings, :default_layout_mode, :string, null: false, default: "fixed"
    add_check_constraint :app_settings, "default_layout_mode IN ('fixed', 'maximize')", name: "app_settings_default_layout_mode_check"
  end
end
