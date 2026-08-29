# The "awaiting a TOTP code" state between a correct password and an
# actual signed-in Session. Same digest-only-storage security property as
# Session (see that model's comment) but a deliberately separate table —
# a user who has only cleared step one of 2FA login was never signed in
# by Session/current_user's own machinery, so that code path needs no
# changes at all to stay safe. Short-lived (5 minutes) since it only needs
# to survive one round trip to an authenticator app.
class TwoFactorChallenge < ApplicationRecord
  TTL = 5.minutes

  belongs_to :user

  attr_reader :raw_token

  class << self
    def start_for(user)
      token = SecureRandom.hex(32)
      challenge = create!(user: user, token_digest: digest(token), expires_at: TTL.from_now)
      challenge.instance_variable_set(:@raw_token, token)
      challenge
    end

    # Returns the live, non-expired challenge for a raw token, or nil. An
    # expired match is deleted on the way out rather than left to rot.
    def authenticate(raw_token)
      return nil if raw_token.blank?
      challenge = find_by(token_digest: digest(raw_token))
      return nil unless challenge
      if challenge.expires_at.past?
        challenge.destroy
        return nil
      end
      challenge
    end

    def digest(raw_token)
      Digest::SHA256.hexdigest(raw_token)
    end
  end
end
