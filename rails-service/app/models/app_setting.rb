# Singleton row. Started deliberately tiny (see the original migration's
# comment); "a general settings store, on a decision to do so" is now
# that decision — Api::Admin::SettingsController is the admin-facing CRUD
# for it.
class AppSetting < ApplicationRecord
  LAYOUT_MODES = %w[fixed maximize].freeze

  belongs_to :homepage_channel, class_name: "Channel", optional: true

  validates :default_layout_mode, inclusion: { in: LAYOUT_MODES }

  def self.instance
    first_or_create!
  end

  def as_public_json
    { defaultLayoutMode: default_layout_mode, publicViewing: public_viewing }
  end
end
