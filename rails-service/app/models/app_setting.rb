# Singleton row. See the migration's comment for why this stays small on
# purpose rather than growing into a general settings store.
class AppSetting < ApplicationRecord
  belongs_to :homepage_channel, class_name: "Channel", optional: true

  def self.instance
    first_or_create!
  end
end
