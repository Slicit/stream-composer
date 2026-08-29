# The login flow's "awaiting second factor" state — a deliberate near-twin
# of Session (same digest-only storage of the raw token) but kept entirely
# separate from it, so a user mid-2FA never has a real Session/cookie at
# all. See Api::AuthController#login and #verify_two_factor.
class CreateTwoFactorChallenges < ActiveRecord::Migration[8.1]
  def change
    create_table :two_factor_challenges, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :token_digest, null: false
      t.datetime :expires_at, null: false
      t.timestamps
    end
    add_index :two_factor_challenges, :token_digest, unique: true
  end
end
