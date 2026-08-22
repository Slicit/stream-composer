# A deliberately tiny singleton table: only the one setting Channel needs
# right now (which channel, if any, "/" redirects to). The Node backend's
# settings object has many more fields (publicViewing, composition config,
# ...) — porting all of that is its own later slice; this is not meant to
# grow into a general key-value store without a decision to do so.
class CreateAppSettings < ActiveRecord::Migration[8.1]
  def change
    create_table :app_settings, id: :uuid do |t|
      t.uuid :homepage_channel_id
      t.timestamps
    end
  end
end
