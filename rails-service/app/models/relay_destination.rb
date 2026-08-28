# Restreaming: forwarding a source on to somebody else's RTMP platform.
# Ported from server/src/relays.js's CRUD half — the *data model*, not the
# ffmpeg process supervision (starting/stopping/backoff/progress), which
# stays a data-plane concern for a later Go slice. This model owns exactly
# what an operator configures: which source, which destination, which key.
# Provider presets and URL/key validation live in RelayDestinationLike,
# shared with ChannelRelayDestination (forwards a composed channel output
# instead of a raw source).
class RelayDestination < ApplicationRecord
  include RelayDestinationLike

  AUDIO_MODES = %w[copy aac].freeze
  MAX_PER_SERVER = 64

  belongs_to :stream

  before_validation { self.audio = "copy" if audio.blank? }

  validates :audio, inclusion: { in: AUDIO_MODES, message: %(must be "copy" or "aac") }
  validate :not_too_many_destinations, on: :create

  def as_public_json
    {
      id: id,
      streamId: stream_id,
      sourceName: stream&.name,
      sourceMissing: stream.nil?,
      provider: provider,
      providerLabel: self.class.provider_by_id(provider)&.fetch(:label) || provider,
      name: name,
      url: url,
      keyMasked: key_masked,
      hasKey: key.present?,
      audio: audio,
      enabled: enabled,
      createdAt: created_at.iso8601,
    }
  end

  private

  def not_too_many_destinations
    errors.add(:base, "That is as many destinations as one server will manage.") if RelayDestination.count >= MAX_PER_SERVER
  end
end
