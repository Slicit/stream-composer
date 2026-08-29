# otp_secret is encrypted at rest (see `encrypts :otp_secret` on User) —
# unlike a password it must be reversible to generate the expected code
# each login, so encryption rather than hashing is the correct primitive
# here. RAILS_MASTER_KEY, already mandatory infrastructure for every
# deployment, is what protects it.
class AddTwoFactorToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :otp_secret, :string
    add_column :users, :otp_enabled, :boolean, null: false, default: false
  end
end
