# The one other setting the data plane's internal API needs today: whether
# an anonymous visitor may watch the composed programme at all. See
# AppSetting's own comment for why this table stays intentionally small.
class AddPublicViewingToAppSettings < ActiveRecord::Migration[8.1]
  def change
    add_column :app_settings, :public_viewing, :boolean, null: false, default: false
  end
end
