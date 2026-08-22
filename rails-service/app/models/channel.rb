# A named, sluggable, curated list of streams any logged-in user may own —
# ported from server/src/channels.js. Always browser-composed (see
# docs/ARCHITECTURE.md, "Channels"): this model owns the configuration
# (name, slug, membership, sharing, background image), not viewing a
# channel's live state, which needs layout computation and live stream
# status — a data-plane concern, not yet ported here (see
# LOGBOOK/features/feat-migration-rails-control-plane.md).
class Channel < ApplicationRecord
  include Accessible

  VISIBILITIES = %w[private public].freeze
  SLUG_FORMAT = /\A[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\z/
  MAX_STREAM_IDS = 64
  MAX_SHARED_WITH = 200

  belongs_to :owner, class_name: "User"

  before_validation :assign_slug, on: :create
  before_validation { self.slug = slug.to_s.strip.downcase if slug.present? }
  before_validation { self.visibility = "private" if visibility.blank? }
  before_validation { self.stream_ids = Array(stream_ids).map(&:to_s).uniq }
  before_validation { self.shared_with = Array(shared_with).uniq }

  validates :name, presence: true, length: { maximum: 48 }
  validates :slug, presence: true, format: { with: SLUG_FORMAT, message: "may only contain lowercase letters, digits and dashes (2-64 characters), and cannot start or end with a dash" }
  validates :slug, uniqueness: { case_sensitive: false, message: "is already in use" }
  validates :visibility, inclusion: { in: VISIBILITIES }
  validate :stream_ids_are_sane
  validate :shared_with_is_sane

  after_destroy :clear_as_homepage_if_needed
  after_destroy :remove_background_image_file

  class << self
    def slugify(value)
      value.to_s.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")[0, 64]
    end

    # The base slug with -2, -3, ... appended until it is free.
    def unique_slug(base, exclude_id: nil)
      root = slugify(base).presence || "channel"
      candidate = root
      n = 2
      while slug_taken?(candidate, exclude_id)
        suffix = "-#{n}"
        candidate = "#{root[0, 64 - suffix.length]}#{suffix}"
        n += 1
      end
      candidate
    end

    def slug_taken?(candidate, exclude_id = nil)
      scope = where("lower(slug) = ?", candidate)
      scope = scope.where.not(id: exclude_id) if exclude_id
      scope.exists?
    end
  end

  def remove_background_image_file
    return if background_image.blank?
    path = Rails.public_path.join(background_image.delete_prefix("/"))
    File.delete(path) if File.exist?(path)
  rescue StandardError
    nil # already gone, or never existed
  end

  def as_public_json
    {
      id: id,
      name: name,
      slug: slug,
      visibility: visibility,
      ownerId: owner_id,
      backgroundImage: background_image.presence,
      streamIds: stream_ids,
      sharedWith: shared_with,
      createdAt: created_at.iso8601,
    }
  end

  private

  def assign_slug
    return if slug.present?
    self.slug = self.class.unique_slug(name)
  end

  def stream_ids_are_sane
    ids = Array(stream_ids)
    if ids.length > MAX_STREAM_IDS
      errors.add(:stream_ids, "is more sources than one channel will compose")
      return
    end
    unknown = ids - Stream.where(id: ids).pluck(:id)
    errors.add(:stream_ids, "references a stream that does not exist") if unknown.any?
  end

  def shared_with_is_sane
    ids = Array(shared_with)
    if ids.length > MAX_SHARED_WITH
      errors.add(:shared_with, "is more people than one channel will track access for")
      return
    end
    unknown = ids - User.where(id: ids).pluck(:id)
    errors.add(:shared_with, "references a user that does not exist") if unknown.any?
  end

  # A deleted homepage channel must not leave "/" redirecting nowhere.
  def clear_as_homepage_if_needed
    setting = AppSetting.instance
    setting.update!(homepage_channel_id: nil) if setting.homepage_channel_id == id
  end
end
