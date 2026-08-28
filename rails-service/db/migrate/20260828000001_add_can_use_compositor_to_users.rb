class AddCanUseCompositorToUsers < ActiveRecord::Migration[8.1]
  def change
    # Admin-granted, opt-in. The server-side compositor is real CPU cost
    # per active job (unlike browser composition, which costs the server
    # nothing) — this stays off for everyone until an admin turns it on for
    # a specific account, deliberately not tied to the streamer role itself.
    add_column :users, :can_use_compositor, :boolean, null: false, default: false
  end
end
