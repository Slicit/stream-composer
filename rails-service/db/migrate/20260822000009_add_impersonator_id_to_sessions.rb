# Set only on a session created by admin impersonation (see
# Api::Admin::UsersController#impersonate) — the admin who started it, so
# "stop impersonating" knows who to sign back in as, and so an audit trail
# ("who was this session really") survives a schema dump either way.
# on_delete: :nullify rather than :cascade: deleting the impersonating
# admin's account should not silently destroy a session someone else
# (the impersonated user, or that same admin) may still be using.
class AddImpersonatorIdToSessions < ActiveRecord::Migration[8.1]
  def change
    add_reference :sessions, :impersonator, type: :uuid, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
  end
end
