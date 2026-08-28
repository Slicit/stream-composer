class ChangeCanUseCompositorToQuota < ActiveRecord::Migration[8.1]
  def change
    remove_column :users, :can_use_compositor, :boolean, null: false, default: false

    # Same shape as stream_quota (admin-set, default 0, self-service
    # capped by it) but a much smaller range: each enabled composition is
    # real, ongoing ffmpeg CPU cost, unlike a stream registration.
    add_column :users, :compositor_quota, :integer, null: false, default: 0
    add_check_constraint :users, "compositor_quota >= 0 AND compositor_quota <= 20", name: "users_compositor_quota_range"
  end
end
