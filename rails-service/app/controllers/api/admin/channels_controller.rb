module Api
  module Admin
    class ChannelsController < ApplicationController
      before_action :require_admin!

      def index
        render json: { channels: Channel.order(:created_at).map(&:as_public_json), homepageChannelId: AppSetting.instance.homepage_channel_id }
      end

      def create
        body = params.permit(:name, :slug, :visibility, :ownerId, streamIds: [], sharedWith: [])
        channel = Channel.new(channel_attrs(body, default_owner_id: current_user.id))
        if channel.save
          render json: { channel: channel.as_public_json }, status: :created
        else
          render_error :bad_request, channel.errors.full_messages.join(", ")
        end
      end

      def update
        channel = Channel.find(params[:id])
        body = params.permit(:name, :slug, :visibility, streamIds: [], sharedWith: [])
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
        attrs = body.to_h.transform_keys { |k| { "ownerId" => "owner_id", "streamIds" => "stream_ids", "sharedWith" => "shared_with" }.fetch(k, k) }
        attrs["owner_id"] ||= default_owner_id if default_owner_id
        attrs
      end
    end
  end
end
