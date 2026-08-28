# A channel's server-side compositor config for one orientation
# (horizontal or vertical) — what to encode at, and (via
# channel_relay_destinations) where to forward the result. Config only:
# the Go data plane reads this to decide what to run; the actual ffmpeg
# process supervision is a data-plane concern, ported from
# server/src/compositor.js. See docs/ARCHITECTURE.md once that lands.
#
# Opt-in and admin-gated (User#compositor_quota) — unlike browser
# composition, an active job here is real, ongoing server CPU cost.
class ChannelComposition < ApplicationRecord
  ORIENTATIONS = %w[horizontal vertical].freeze
  ENCODERS = %w[auto software vaapi qsv].freeze

  belongs_to :channel
  has_many :channel_relay_destinations, dependent: :destroy

  before_validation { self.orientation = orientation.to_s.strip.downcase }
  before_validation { self.encoder = "auto" if encoder.blank? }
  before_validation { self.preset = "veryfast" if preset.blank? }

  validates :orientation, inclusion: { in: ORIENTATIONS }
  validates :orientation, uniqueness: { scope: :channel_id, message: "already has a composition for this channel" }
  validates :encoder, inclusion: { in: ENCODERS }
  validates :width, :height, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 3840 }
  validates :fps, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 60 }
  validates :bitrate_kbps, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: 51_000 }
  validates :label_size, numericality: { only_integer: true, greater_than_or_equal_to: 10, less_than_or_equal_to: 72 }
  validate :background_color_is_hex

  def as_public_json
    {
      id: id,
      channelId: channel_id,
      orientation: orientation,
      enabled: enabled,
      width: width,
      height: height,
      fps: fps,
      bitrateKbps: bitrate_kbps,
      preset: preset,
      encoder: encoder,
      backgroundColor: background_color,
      labels: labels,
      labelSize: label_size,
      destinations: channel_relay_destinations.order(:created_at).map(&:as_public_json),
      createdAt: created_at.iso8601,
    }
  end

  private

  def background_color_is_hex
    return if background_color.blank?
    errors.add(:background_color, "must be a 6-digit hex color") unless background_color.match?(/\A#[0-9a-fA-F]{6}\z/)
  end
end
