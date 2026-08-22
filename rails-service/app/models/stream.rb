# A configured ingest slot: what OBS publishes to, and what a viewer
# watches. Ported from server/src/streams.js — same field shapes, same
# validation rules, same key/playback-id generation, so migrating a stream
# from the old config.json is a straight field copy.
class Stream < ApplicationRecord
  include Accessible

  # No 0/O, 1/l/I — unambiguous when read aloud or typed by hand.
  KEY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789".chars.freeze
  KEY_FORMAT = /\A[A-Za-z0-9_-]{6,64}\z/
  VISIBILITIES = %w[private public].freeze
  MAX_SHARED_WITH = 200

  belongs_to :owner, class_name: "User", optional: true

  before_validation :assign_key, on: :create
  before_validation :assign_playback_id, on: :create
  before_validation { self.nickname = nickname.to_s.gsub(/[\r\n\t]+/, " ").strip }
  before_validation { self.visibility = "private" if visibility.blank? }
  before_validation { self.shared_with = Array(shared_with).uniq }

  validates :name, presence: true, length: { maximum: 48 }
  validates :nickname, length: { maximum: 32 }
  validates :key, presence: true, format: { with: KEY_FORMAT, message: "may only contain letters, digits, dashes and underscores (6-64 characters)" }, uniqueness: true
  validates :playback_id, presence: true, uniqueness: true
  validates :visibility, inclusion: { in: VISIBILITIES }
  validate :shared_with_is_sane

  # The public, non-secret handle a viewer uses to address this stream.
  # 12 random bytes, same as generatePlaybackId() in streams.js.
  def self.generate_playback_id
    SecureRandom.hex(12)
  end

  def self.generate_key(length = 20)
    Array.new(length) { KEY_ALPHABET.sample }.join
  end

  def as_public_json
    {
      id: id,
      name: name,
      nickname: nickname,
      key: key,
      playbackId: playback_id,
      enabled: enabled,
      note: note,
      visibility: visibility,
      ownerId: owner_id,
      sharedWith: shared_with,
      createdAt: created_at.iso8601,
    }
  end

  private

  def assign_key
    self.key = self.class.generate_key if key.blank?
  end

  def assign_playback_id
    self.playback_id = self.class.generate_playback_id if playback_id.blank?
  end

  def shared_with_is_sane
    ids = Array(shared_with)
    if ids.length > MAX_SHARED_WITH
      errors.add(:shared_with, "is more people than one stream will track access for")
      return
    end
    unknown = ids - User.where(id: ids).pluck(:id)
    errors.add(:shared_with, "references a user that does not exist") if unknown.any?
  end
end
