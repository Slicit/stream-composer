module Internal
  # The Go data plane's view of every stream and restream destination —
  # polled, not looked up per-request (see
  # go-service/internal/streamstore.RailsBridge), so a media auth decision
  # or a relay-runner tick never waits on an HTTP round trip to this
  # service. Mirrors server/src/routes/hooks.js's own convention: the
  # shared secret travels in the URL, since this is the one channel
  # guaranteed to never reach a browser. Relay keys travel in full here
  # (never masked) for the same reason streams.js's own internal callers
  # always saw the real ingest key — this is server-to-server, behind the
  # shared secret, not a response a browser ever sees.
  class StreamsController < ActionController::API
    before_action :verify_token!

    def index
      render json: {
        streams: Stream.all.map do |s|
          { id: s.id, key: s.key, playbackId: s.playback_id, enabled: s.enabled,
            visibility: s.visibility, ownerId: s.owner_id, sharedWith: s.shared_with,
            name: s.name, nickname: s.nickname }
        end,
        relays: RelayDestination.all.map do |r|
          { id: r.id, streamId: r.stream_id, provider: r.provider, name: r.name,
            url: r.url, key: r.key, audio: r.audio, enabled: r.enabled }
        end,
        settings: { publicViewing: AppSetting.instance.public_viewing },
      }
    end

    private

    def verify_token!
      expected = ENV["INTERNAL_API_TOKEN"]
      if expected.blank?
        Rails.logger.error("INTERNAL_API_TOKEN is not set — refusing every internal API request")
        return render(json: { error: "not configured" }, status: :unauthorized)
      end
      return if ActiveSupport::SecurityUtils.secure_compare(params[:token].to_s, expected)

      render json: { error: "Not found." }, status: :not_found
    end
  end
end
