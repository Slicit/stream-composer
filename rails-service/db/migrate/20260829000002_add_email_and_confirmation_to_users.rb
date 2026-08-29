# Self-registration needs an email address and a way to prove the user
# actually controls it. Nullable everywhere: admin-created accounts
# (including the bootstrap admin) keep no email at all and are treated as
# already "confirmed" — see User#email_confirmation_required?. Only the
# token's SHA-256 digest is stored, matching Session's own digest-only
# storage, so a database leak alone can't be replayed as a confirmation
# link.
class AddEmailAndConfirmationToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :email, :string
    add_column :users, :email_confirmed_at, :datetime
    add_column :users, :confirmation_token_digest, :string
    add_column :users, :confirmation_sent_at, :datetime

    add_index :users, "lower(email)", unique: true, where: "email IS NOT NULL", name: "index_users_on_lower_email"
  end
end
