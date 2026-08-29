# One-time recovery codes for a user who loses their authenticator app —
# each is single-use, stored only as a SHA-256 digest (same reasoning as
# every other secret in this app: Session#token_digest,
# confirmation_token_digest). Consuming a code removes its digest from the
# array; regenerating replaces the whole set.
class AddOtpBackupCodesToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :otp_backup_code_digests, :string, array: true, null: false, default: []
  end
end
