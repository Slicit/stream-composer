module Api
  # Self-service compositor config: /api/channels/mine/:channel_id/compositions.
  # Ownership follows the channel (mirrors Api::ChannelsController's
  # owned_channel!, admin bypass included), and every action additionally
  # requires compositor_quota > 0 — this is the "heavy streamer" opt-in
  # gate, admin excepted. Nested under the channel rather than a flat
  # /compositions/mine like relays/mine: a composition isn't an
  # independently-creatable row the way a relay is, it's exactly one
  # config slot per (channel, orientation), so "index" always returns
  # both, lazily created.
  class ChannelCompositionsController < ApplicationController
    before_action :require_compositor_access!

    def index
      channel = owned_channel!
      return unless channel

      render json: {
        compositions: ChannelComposition::ORIENTATIONS.map { |o| composition_for(channel, o).as_public_json },
        providers: ChannelRelayDestination::PROVIDERS,
        quota: current_user.compositor_quota,
      }
    end

    def update
      channel = owned_channel!
      return unless channel
      return render_error(:bad_request, "Unknown orientation.") unless ChannelComposition::ORIENTATIONS.include?(params[:orientation])

      composition = composition_for(channel, params[:orientation])
      patch = composition_params

      if enabling?(composition, patch) && current_user.role != "admin" && enabled_composition_count(exclude: composition) >= current_user.compositor_quota
        return render_error(:forbidden, "You have reached your limit of #{current_user.compositor_quota} composition(s). Ask an admin to raise it.")
      end

      if composition.update(patch)
        render json: { composition: composition.as_public_json }
      else
        render_error :bad_request, composition.errors.full_messages.join(", ")
      end
    end

    def create_destination
      composition = owned_composition!
      return unless composition

      destination = composition.channel_relay_destinations.new(destination_params)
      if destination.save
        render json: { destination: destination.as_public_json }, status: :created
      else
        render_error :bad_request, destination.errors.full_messages.join(", ")
      end
    end

    def update_destination
      destination = owned_destination!
      return unless destination

      if destination.update(destination_params.merge(destination_patch_only_params))
        render json: { destination: destination.as_public_json }
      else
        render_error :bad_request, destination.errors.full_messages.join(", ")
      end
    end

    def destroy_destination
      destination = owned_destination!
      return unless destination

      destination.destroy
      render json: { ok: true }
    end

    private

    def composition_for(channel, orientation)
      channel.channel_compositions.find_or_create_by!(orientation: orientation)
    end

    # True only when this update would newly enable a composition that
    # wasn't already enabled — flipping an already-enabled one, or
    # changing anything else about it, doesn't grow the count and so
    # never needs a quota check.
    def enabling?(composition, patch)
      return false unless patch.key?("enabled")
      ActiveModel::Type::Boolean.new.cast(patch["enabled"]) && !composition.enabled
    end

    def enabled_composition_count(exclude:)
      ChannelComposition.joins(:channel)
                         .where(channels: { owner_id: current_user.id }, enabled: true)
                         .where.not(id: exclude.id)
                         .count
    end

    def composition_params
      params.permit(:enabled, :width, :height, :fps, :bitrateKbps, :preset, :encoder, :backgroundColor, :labels, :labelSize)
            .to_h.transform_keys { |k| { "bitrateKbps" => "bitrate_kbps", "backgroundColor" => "background_color", "labelSize" => "label_size" }.fetch(k, k) }
    end

    def destination_params
      params.permit(:provider, :name, :url, :key).to_h
    end

    def destination_patch_only_params
      params.key?(:enabled) ? { "enabled" => ActiveModel::Type::Boolean.new.cast(params[:enabled]) } : {}
    end

    def owned_channel!
      channel = Channel.find_by(id: params[:channel_id])
      unless channel
        render_not_found("No such thing.")
        return nil
      end
      return channel if channel.owner_id == current_user.id || current_user.role == "admin"

      render_forbidden("You do not own this.")
      nil
    end

    # A destination belongs to a composition, which belongs to a channel —
    # ownership is checked at that root, same as owned_channel! everywhere
    # else in this controller.
    def owned_composition!
      channel = owned_channel!
      return nil unless channel
      return render_error(:bad_request, "Unknown orientation.") && nil unless ChannelComposition::ORIENTATIONS.include?(params[:orientation])

      composition_for(channel, params[:orientation])
    end

    def owned_destination!
      composition = owned_composition!
      return nil unless composition

      destination = composition.channel_relay_destinations.find_by(id: params[:id])
      unless destination
        render_not_found("No such destination.")
        return nil
      end
      destination
    end
  end
end
