module Api
  # Self-service "my channels": /api/channels/mine. Any signed-in user may
  # own channels, not just streamer/admin — mirrors
  # server/src/routes/channels.js's "mine" sub-router, which is gated by
  # auth.requireUser only. Full config control over one's own channel (no
  # allowlist like the streamer role's stream PATCH has): owning a channel
  # is itself the capability, there is no separate quota gate here.
  class ChannelsController < ApplicationController
    before_action :require_user!

    MAX_BACKGROUND_BYTES = 5 * 1024 * 1024
    IMAGE_EXTENSIONS = { "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp", "image/gif" => "gif" }.freeze

    def index
      render json: { channels: current_user.owned_channels.order(:created_at).map(&:as_public_json) }
    end

    # Every channel this user can view — public, owned, or explicitly
    # shared (Channel#accessible_to?, the same rule channel-state access
    # and the go-service data plane both already use). Powers the left
    # nav's channel list. Loaded and filtered in Ruby rather than a SQL
    # WHERE: the accessible_to? check already exists as one shared method
    # (Accessible concern) and the channel count here is not large enough
    # to matter.
    def accessible
      channels = Channel.order(:created_at).select { |c| c.accessible_to?(current_user) }
      render json: { channels: channels.map(&:as_public_json) }
    end

    CHANNEL_PARAMS = %i[name slug visibility description].freeze
    EXTRA_CHANNEL_PARAMS = %i[currentTopic featuredGameId layoutMode].freeze

    def show
      channel = owned_channel!
      return unless channel

      render json: { channel: channel.as_public_json }
    end

    def create
      channel = current_user.owned_channels.new(channel_attrs(params.permit(*CHANNEL_PARAMS, *EXTRA_CHANNEL_PARAMS, streamIds: [], sharedWith: [])))
      if channel.save
        render json: { channel: channel.as_public_json }, status: :created
      else
        render_error :bad_request, channel.errors.full_messages.join(", ")
      end
    end

    def update
      channel = owned_channel!
      return unless channel

      if channel.update(channel_attrs(params.permit(*CHANNEL_PARAMS, *EXTRA_CHANNEL_PARAMS, streamIds: [], sharedWith: [])))
        render json: { channel: channel.as_public_json }
      else
        render_error :bad_request, channel.errors.full_messages.join(", ")
      end
    end

    def destroy
      channel = owned_channel!
      return unless channel

      channel.destroy
      render json: { ok: true }
    end

    # No multipart parsing, no new dependency: the client PUTs the image
    # bytes directly with its own Content-Type, mirroring
    # express.raw({type:'image/*'}) in the Node backend exactly.
    def background
      channel = owned_channel!
      return unless channel

      ext = IMAGE_EXTENSIONS[request.content_type]
      return render_error(:bad_request, "Background images must be PNG, JPEG, WebP or GIF.") unless ext

      body = request.body.read
      return render_error(:bad_request, "The uploaded file was empty.") if body.blank?
      return render_error(:bad_request, "Background images must be 5MB or smaller.") if body.bytesize > MAX_BACKGROUND_BYTES

      dir = Rails.public_path.join("uploads", "channel-backgrounds")
      FileUtils.mkdir_p(dir)
      channel.remove_background_image_file
      filename = "#{channel.id}.#{ext}"
      File.binwrite(dir.join(filename), body)

      channel.update!(background_image: "/uploads/channel-backgrounds/#{filename}")
      render json: { channel: channel.as_public_json }
    end

    private

    def channel_attrs(body)
      body.to_h.transform_keys do |k|
        { "streamIds" => "stream_ids", "sharedWith" => "shared_with", "currentTopic" => "current_topic",
          "featuredGameId" => "featured_game_id", "layoutMode" => "layout_mode" }.fetch(k, k)
      end
    end

    def owned_channel!
      channel = Channel.find_by(id: params[:id])
      unless channel
        render_not_found("No such thing.")
        return nil
      end
      return channel if channel.owner_id == current_user.id || current_user.role == "admin"

      render_forbidden("You do not own this.")
      nil
    end
  end
end
