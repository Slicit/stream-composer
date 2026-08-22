# A signed-in session. The random token itself is only ever held by the
# client, in the sc_session cookie; the database stores its SHA-256 digest,
# not the token, so a database leak alone cannot be used to sign in as
# anyone — a step beyond the Node backend's stateless signed cookie, made
# easy by having a real database now.
class Session < ApplicationRecord
  TTL = 14.days

  belongs_to :user

  attr_reader :raw_token

  class << self
    def start_for(user)
      token = SecureRandom.hex(32)
      session = create!(user: user, token_digest: digest(token), expires_at: TTL.from_now)
      session.instance_variable_set(:@raw_token, token)
      session
    end

    # Returns the live, non-expired session for a raw cookie token, or nil.
    # An expired match is deleted on the way out rather than left to rot.
    def authenticate(raw_token)
      return nil if raw_token.blank?
      authenticate_by_digest(digest(raw_token))
    end

    # Same lookup as authenticate, but for a caller that already has the
    # digest rather than the raw token — the Go data plane's internal
    # session check, so a leaked request/log never carries anything a
    # cookie thief could replay directly (a digest lookup is one-way; the
    # raw token isn't).
    def authenticate_by_digest(token_digest)
      return nil if token_digest.blank?
      session = find_by(token_digest: token_digest)
      return nil unless session
      if session.expires_at.past?
        session.destroy
        return nil
      end
      session
    end

    def digest(raw_token)
      Digest::SHA256.hexdigest(raw_token)
    end
  end
end
