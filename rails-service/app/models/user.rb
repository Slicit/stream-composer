# A person who can sign in. Three roles:
#   admin    — full control of everything
#   streamer — self-service over their own streams, up to stream_quota
#   viewer   — the player only
#
# Passwords are scrypt (N: 16384, r: 8, p: 1, keylen: 64), byte-for-byte
# compatible with the Node backend's server/src/auth.js — confirmed against
# the same salt/password producing an identical hash on both sides. This is
# what makes the config.json -> Postgres migration a straight copy of
# salt/password_hash with no forced password reset.
class User < ApplicationRecord
  ROLES = %w[admin viewer streamer].freeze
  USERNAME_FORMAT = /\A[a-zA-Z0-9._-]{2,32}\z/
  SCRYPT = { n: 16384, r: 8, p: 1, length: 64 }.freeze

  has_many :sessions, dependent: :destroy
  has_many :owned_streams, class_name: "Stream", foreign_key: :owner_id, inverse_of: :owner, dependent: nil
  has_many :owned_channels, class_name: "Channel", foreign_key: :owner_id, inverse_of: :owner, dependent: :destroy

  before_validation { self.username = username.to_s.strip }
  before_validation { self.role = "viewer" if role.blank? }

  validates :username, format: { with: USERNAME_FORMAT, message: "must be 2-32 characters: letters, digits, dot, dash or underscore" }
  validates :username, uniqueness: { case_sensitive: false, message: "is already taken" }
  validates :role, inclusion: { in: ROLES, message: "must be admin, viewer or streamer" }
  validates :stream_quota, numericality: { only_integer: true, greater_than_or_equal_to: 0, less_than_or_equal_to: 1000 }

  validates :password, presence: true, on: :create, unless: -> { @password_assignment_attempted || @importing_legacy_hash }
  validate :password_is_strong, if: -> { @password_assignment_attempted }
  validate :cannot_change_an_admins_role, on: :update, if: :role_changed?

  before_destroy :refuse_to_delete_the_last_admin

  attr_reader :password

  # Setting password= hashes and stores it immediately (salt + password_hash),
  # rather than deferring to a save callback, so a user built entirely in
  # memory (as the migration script does) still gets a real, verifiable hash.
  def password=(new_password)
    @password_assignment_attempted = true
    @password = new_password
    problems = password_problems(new_password)
    if problems.empty?
      self.salt = SecureRandom.hex(16)
      self.password_hash = self.class.scrypt_hex(new_password, salt)
    end
  end

  def authenticate(candidate)
    return false if salt.blank? || password_hash.blank?
    given = self.class.scrypt_hex(candidate.to_s, salt)
    ActiveSupport::SecurityUtils.secure_compare(given, password_hash)
  end

  # The shape every API response actually serializes — never salt/password_hash.
  def as_public_json
    {
      id: id,
      username: username,
      role: role,
      streamQuota: stream_quota,
      createdAt: created_at.iso8601,
      lastLoginAt: last_login_at&.iso8601,
    }
  end

  class << self
    def scrypt_hex(password, salt)
      OpenSSL::KDF.scrypt(password.to_s, salt: salt, N: SCRYPT[:n], r: SCRYPT[:r], p: SCRYPT[:p], length: SCRYPT[:length]).unpack1("H*")
    end

    # A constant-ish amount of work runs whether or not the username
    # exists, so a missing user is not measurably faster than a wrong
    # password — mirrors auth.js's authenticate()'s decoy hash.
    def authenticate_credentials(username, password)
      user = find_by("lower(username) = ?", username.to_s.strip.downcase)
      unless user
        scrypt_hex(password.to_s, "decoy-salt-decoy-salt")
        return nil
      end
      user.authenticate(password) ? user : nil
    end

    # Rebuilds a user straight from an already-hashed config.json record —
    # see lib/tasks/migrate_from_json.rake. Bypasses password= (which exists
    # to hash a fresh plaintext password) entirely, since scrypt_hex is
    # byte-for-byte compatible with what auth.js already produced; there is
    # nothing to rehash and no plaintext to validate the strength of.
    def import_legacy!(id:, username:, role:, stream_quota:, salt:, password_hash:, created_at:, last_login_at:)
      user = find_or_initialize_by(id: id)
      user.assign_attributes(username: username, role: role, stream_quota: stream_quota, last_login_at: last_login_at)
      user.salt = salt
      user.password_hash = password_hash
      user.instance_variable_set(:@importing_legacy_hash, true)
      user.created_at = created_at if created_at && user.new_record?
      user.save!
      user
    end

    # Mirrors auth.js's ensureBootstrapAdmin(): only ever acts on a
    # genuinely empty install (no users at all), from ADMIN_USER/
    # ADMIN_PASSWORD, generating and printing a random password when
    # ADMIN_PASSWORD is unset or too weak. Called from db/seeds.rb, not an
    # initializer — an initializer running database queries at every Rails
    # boot (console, asset tasks, migrations) is the well-known anti-pattern
    # this deliberately avoids.
    def ensure_bootstrap_admin!
      return if exists?

      password = ENV["ADMIN_PASSWORD"].presence
      generated = false
      if password.nil? || password.length < 8 || password.match?(/\A\s|\s\z/)
        password = SecureRandom.urlsafe_base64(12)
        generated = true
      end

      username = ENV["ADMIN_USER"].presence || "admin"
      unless username.match?(USERNAME_FORMAT)
        warn %(ADMIN_USER "#{username}" is not a valid username — using "admin" instead)
        username = "admin"
      end

      user = create!(username: username, password: password, role: "admin")

      if generated
        puts <<~BANNER

          ┌────────────────────────────────────────────────────────────┐
          │  Stream Composer — initial administrator account created   │
          └────────────────────────────────────────────────────────────┘
             username: #{user.username}
             password: #{password}

          Set ADMIN_PASSWORD to choose your own, or change it after signing in.
        BANNER
      end

      user
    end
  end

  private

  def password_problems(candidate)
    issues = []
    issues << "must be at least 8 characters" if candidate.to_s.length < 8
    issues << "must not start or end with whitespace" if candidate.to_s.match?(/\A\s|\s\z/)
    issues
  end

  def password_is_strong
    problems = password_problems(@password)
    errors.add(:password, problems.join(" and ")) if problems.any?
  end

  def cannot_change_an_admins_role
    return unless role_was == "admin"
    errors.add(:role, "cannot be changed — admins cannot be demoted")
  end

  def refuse_to_delete_the_last_admin
    return unless role == "admin"
    return if User.where(role: "admin").where.not(id: id).exists?
    errors.add(:base, "This is the last administrator — create another one first.")
    throw :abort
  end
end
