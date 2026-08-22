module Internal
  # The Go data plane's view of every stream — polled, not looked up
  # per-request (see go-service/internal/streamstore.RailsBridge), so a
  # media auth decision never waits on an HTTP round trip to this service.
  # Mirrors server/src/routes/hooks.js's own convention: the shared secret
  # travels in the URL, since this is the one channel guaranteed to never
  # reach a browser.
  class StreamsController < ActionController::API
    before_action :verify_token!

    def index
      render json: {
        streams: Stream.all.map do |s|
          { id: s.id, key: s.key, playbackId: s.playback_id, enabled: s.enabled,
            visibility: s.visibility, ownerId: s.owner_id, sharedWith: s.shared_with }
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
