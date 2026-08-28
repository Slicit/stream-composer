# Forwarding a channel's *composed* output on to a platform — the
# composition-scoped equivalent of RelayDestination, which forwards one raw
# source. Provider presets and URL/key validation are shared via
# RelayDestinationLike; see that concern for what this deliberately does
# not add (an audio mode — the composed program is a single already-encoded
# feed by the time a destination sees it, nothing to choose per-destination).
class ChannelRelayDestination < ApplicationRecord
  include RelayDestinationLike

  MAX_PER_COMPOSITION = 8

  belongs_to :channel_composition

  validate :not_too_many_destinations, on: :create

  def as_public_json
    {
      id: id,
      channelCompositionId: channel_composition_id,
      provider: provider,
      providerLabel: self.class.provider_by_id(provider)&.fetch(:label) || provider,
      name: name,
      url: url,
      keyMasked: key_masked,
      hasKey: key.present?,
      enabled: enabled,
      createdAt: created_at.iso8601,
    }
  end

  private

  def not_too_many_destinations
    return unless channel_composition
    if channel_composition.channel_relay_destinations.count >= MAX_PER_COMPOSITION
      errors.add(:base, "That is as many destinations as one composition will manage.")
    end
  end
end
