module Api
  # Self-service for the "streamer" role: /api/streams/mine. Scoped to
  # exactly what the caller owns, mirroring server/src/routes/streamer.js —
  # deliberately not exposing shared_with editing (needs a full user picker,
  # which a non-admin has no business seeing), arbitrary key-setting
  # (rotate only), or owner reassignment (admin-only, via Api::Admin::StreamsController).
  class StreamsController < ApplicationController
    before_action :require_streamer_or_admin!

    ALLOWED_UPDATE_FIELDS = %w[name nickname visibility enabled note].freeze

    def index
      render json: { streams: current_user.owned_streams.order(:created_at).map(&:as_public_json), quota: current_user.stream_quota }
    end

    def create
      if current_user.role != "admin" && current_user.owned_streams.count >= current_user.stream_quota
        return render_error(:forbidden, "You have reached your limit of #{current_user.stream_quota} stream(s). Ask an admin to raise it.")
      end

      stream = current_user.owned_streams.new(params.permit(:name, :nickname, :key, :visibility))
      if stream.save
        render json: { stream: stream.as_public_json }, status: :created
      else
        render_error :bad_request, stream.errors.full_messages.join(", ")
      end
    end

    def update
      stream = owned_stream!
      return unless stream

      patch = params.to_unsafe_h.slice(*ALLOWED_UPDATE_FIELDS)
      if stream.update(patch)
        render json: { stream: stream.as_public_json }
      else
        render_error :bad_request, stream.errors.full_messages.join(", ")
      end
    end

    def rotate_key
      stream = owned_stream!
      return unless stream

      if stream.update(key: Stream.generate_key)
        render json: { stream: stream.as_public_json }
      else
        render_error :bad_request, stream.errors.full_messages.join(", ")
      end
    end

    def destroy
      stream = owned_stream!
      return unless stream

      stream.destroy
      render json: { ok: true }
    end

    private

    # Nil, having already rendered a 403/404, when the caller does not own
    # this stream — the same "never reveal whether an id exists otherwise"
    # posture as access.requireOwner in the other two implementations.
    def owned_stream!
      stream = Stream.find_by(id: params[:id])
      unless stream
        render_not_found("No such thing.")
        return nil
      end
      return stream if stream.owner_id == current_user.id || current_user.role == "admin"

      render_forbidden("You do not own this.")
      nil
    end
  end
end
