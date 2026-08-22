module Api
  module Admin
    class RelaysController < ApplicationController
      before_action :require_admin!

      def index
        render json: {
          relays: RelayDestination.order(:created_at).map(&:as_public_json),
          providers: RelayDestination::PROVIDERS,
        }
      end

      def create
        relay = RelayDestination.new(relay_params)
        if relay.save
          render json: { relay: relay.as_public_json }, status: :created
        else
          render_error :bad_request, relay.errors.full_messages.join(", ")
        end
      end

      def update
        relay = RelayDestination.find(params[:id])
        if relay.update(relay_params)
          render json: { relay: relay.as_public_json }
        else
          render_error :bad_request, relay.errors.full_messages.join(", ")
        end
      end

      def destroy
        RelayDestination.find(params[:id]).destroy
        render json: { ok: true }
      end

      private

      def relay_params
        permitted = params.permit(:streamId, :provider, :name, :url, :key, :audio, :enabled)
        permitted.to_h.transform_keys { |k| k == "streamId" ? "stream_id" : k }
      end
    end
  end
end
