module Api
  module Admin
    # Admin equivalent of Api::ChannelCompositionsController — same
    # behavior, minus the ownership/compositor_quota gates (admin
    # access already implies both), so the admin channel edit page can
    # manage any channel's compositor config regardless of who owns it
    # or whether that owner has been granted compositor access.
    class ChannelCompositionsController < ApplicationController
      before_action :require_admin!

      def index
        channel = Channel.find(params[:channel_id])
        render json: {
          compositions: ChannelComposition::ORIENTATIONS.map { |o| composition_for(channel, o).as_public_json },
          providers: ChannelRelayDestination::PROVIDERS,
        }
      end

      def update
        channel = Channel.find(params[:channel_id])
        return render_error(:bad_request, "Unknown orientation.") unless ChannelComposition::ORIENTATIONS.include?(params[:orientation])

        composition = composition_for(channel, params[:orientation])
        if composition.update(composition_params)
          render json: { composition: composition.as_public_json }
        else
          render_error :bad_request, composition.errors.full_messages.join(", ")
        end
      end

      def create_destination
        composition = composition!
        return unless composition

        destination = composition.channel_relay_destinations.new(destination_params)
        if destination.save
          render json: { destination: destination.as_public_json }, status: :created
        else
          render_error :bad_request, destination.errors.full_messages.join(", ")
        end
      end

      def update_destination
        destination = destination!
        return unless destination

        patch = destination_params
        patch["enabled"] = ActiveModel::Type::Boolean.new.cast(params[:enabled]) if params.key?(:enabled)
        if destination.update(patch)
          render json: { destination: destination.as_public_json }
        else
          render_error :bad_request, destination.errors.full_messages.join(", ")
        end
      end

      def destroy_destination
        destination = destination!
        return unless destination

        destination.destroy
        render json: { ok: true }
      end

      private

      def composition_for(channel, orientation)
        channel.channel_compositions.find_or_create_by!(orientation: orientation)
      end

      def composition_params
        params.permit(:enabled, :width, :height, :fps, :bitrateKbps, :preset, :encoder, :backgroundColor, :labels, :labelSize)
              .to_h.transform_keys { |k| { "bitrateKbps" => "bitrate_kbps", "backgroundColor" => "background_color", "labelSize" => "label_size" }.fetch(k, k) }
      end

      def destination_params
        params.permit(:provider, :name, :url, :key).to_h
      end

      def composition!
        channel = Channel.find(params[:channel_id])
        return render_error(:bad_request, "Unknown orientation.") && nil unless ChannelComposition::ORIENTATIONS.include?(params[:orientation])

        composition_for(channel, params[:orientation])
      end

      def destination!
        composition = composition!
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
end
