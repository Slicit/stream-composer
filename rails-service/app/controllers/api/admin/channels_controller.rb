module Api
  module Admin
    class ChannelsController < ApplicationController
      before_action :require_admin!

      def index
        render json: { channels: Channel.order(:created_at).map(&:as_public_json), homepageChannelId: AppSetting.instance.homepage_channel_id }
      end

      def create
        body = params.permit(:name, :slug, :visibility, :ownerId, :description, :currentTopic, :featuredGameId, streamIds: [], sharedWith: [])
        channel = Channel.new(channel_attrs(body, default_owner_id: current_user.id))
        if channel.save
          render json: { channel: channel.as_public_json }, status: :created
        else
          render_error :bad_request, channel.errors.full_messages.join(", ")
        end
      end

      def show
        render json: { channel: Channel.find(params[:id]).as_public_json }
      end

      def update
        channel = Channel.find(params[:id])
        body = params.permit(:name, :slug, :visibility, :description, :currentTopic, :featuredGameId, :layoutMode, :ownerId, streamIds: [], sharedWith: [])
        if channel.update(channel_attrs(body))
          render json: { channel: channel.as_public_json }
        else
          render_error :bad_request, channel.errors.full_messages.join(", ")
        end
      end

      def destroy
        Channel.find(params[:id]).destroy
        render json: { ok: true }
      end

      # Same raw-body upload as Api::ChannelsController#background (that
      # action already accepts an admin acting on any channel via
      # owned_channel!'s admin bypass) — a dedicated action here just so
      # the admin edit page's whole API surface stays under /api/admin,
      # rather than reaching over to the self-service one for this alone.
      def background
        channel = Channel.find(params[:id])
        ext = Api::ChannelsController::IMAGE_EXTENSIONS[request.content_type]
        return render_error(:bad_request, "Background images must be PNG, JPEG, WebP or GIF.") unless ext

        body = request.body.read
        return render_error(:bad_request, "The uploaded file was empty.") if body.blank?
        return render_error(:bad_request, "Background images must be 5MB or smaller.") if body.bytesize > Api::ChannelsController::MAX_BACKGROUND_BYTES

        dir = Rails.public_path.join("uploads", "channel-backgrounds")
        FileUtils.mkdir_p(dir)
        channel.remove_background_image_file
        filename = "#{channel.id}.#{ext}"
        File.binwrite(dir.join(filename), body)

        channel.update!(background_image: "/uploads/channel-backgrounds/#{filename}")
        render json: { channel: channel.as_public_json }
      end

      def set_homepage
        channel = Channel.find(params[:id])
        AppSetting.instance.update!(homepage_channel_id: channel.id)
        render json: { channel: channel.as_public_json }
      end

      def clear_homepage
        AppSetting.instance.update!(homepage_channel_id: nil)
        head :no_content
      end

      private

      def channel_attrs(body, default_owner_id: nil)
        attrs = body.to_h.transform_keys do |k|
          { "ownerId" => "owner_id", "streamIds" => "stream_ids", "sharedWith" => "shared_with",
            "currentTopic" => "current_topic", "featuredGameId" => "featured_game_id",
            "layoutMode" => "layout_mode" }.fetch(k, k)
        end
        attrs["owner_id"] ||= default_owner_id if default_owner_id
        attrs
      end
    end
  end
end
