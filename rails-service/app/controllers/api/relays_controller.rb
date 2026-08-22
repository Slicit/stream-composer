module Api
  # Self-service restream destinations: /api/relays/mine. Ownership follows
  # the source stream, not the relay itself — mirrors
  # server/src/routes/streamer.js's ownRelay() exactly, including that a
  # streamer may never point a destination at a stream they do not own,
  # neither on create nor by reassigning streamId on an existing one.
  class RelaysController < ApplicationController
    before_action :require_streamer_or_admin!

    def index
      mine = RelayDestination.joins(:stream).where(streams: { owner_id: current_user.id })
      render json: {
        relays: mine.order(:created_at).map(&:as_public_json),
        providers: RelayDestination::PROVIDERS,
        sources: current_user.owned_streams.order(:created_at).map { |s| { id: s.id, name: s.name, enabled: s.enabled } },
      }
    end

    def create
      stream = owned_stream!(params[:streamId])
      return unless stream

      relay = stream.relay_destinations.new(params.permit(:provider, :name, :url, :key, :audio))
      if relay.save
        render json: { relay: relay.as_public_json }, status: :created
      else
        render_error :bad_request, relay.errors.full_messages.join(", ")
      end
    end

    def update
      relay = owned_relay!
      return unless relay

      if params[:streamId].present?
        new_stream = owned_stream!(params[:streamId])
        return unless new_stream
      end

      patch = params.permit(:provider, :name, :url, :key, :audio, :enabled).to_h
      patch["stream_id"] = new_stream.id if new_stream

      if relay.update(patch)
        render json: { relay: relay.as_public_json }
      else
        render_error :bad_request, relay.errors.full_messages.join(", ")
      end
    end

    def destroy
      relay = owned_relay!
      return unless relay

      relay.destroy
      render json: { ok: true }
    end

    def key
      relay = owned_relay!
      return unless relay

      render json: { key: relay.key }
    end

    private

    def owned_stream!(stream_id)
      stream = Stream.find_by(id: stream_id)
      unless stream
        render_not_found("No such thing.")
        return nil
      end
      return stream if stream.owner_id == current_user.id || current_user.role == "admin"

      render_forbidden("You do not own this.")
      nil
    end

    def owned_relay!
      relay = RelayDestination.find_by(id: params[:id])
      unless relay
        render_not_found("No such destination.")
        return nil
      end
      stream = relay.stream
      return relay if stream && (stream.owner_id == current_user.id || current_user.role == "admin")

      render_forbidden("You do not own this.")
      nil
    end
  end
end
