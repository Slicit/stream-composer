module Api
  module Admin
    class StreamsController < ApplicationController
      before_action :require_admin!

      def index
        render json: { streams: Stream.order(:created_at).map(&:as_public_json) }
      end

      def create
        stream = Stream.new(stream_params)
        if stream.save
          render json: { stream: stream.as_public_json }, status: :created
        else
          render_error :bad_request, stream.errors.full_messages.join(", ")
        end
      end

      def update
        stream = Stream.find(params[:id])
        if stream.update(stream_params)
          render json: { stream: stream.as_public_json }
        else
          render_error :bad_request, stream.errors.full_messages.join(", ")
        end
      end

      def rotate_key
        stream = Stream.find(params[:id])
        if stream.update(key: Stream.generate_key)
          render json: { stream: stream.as_public_json }
        else
          render_error :bad_request, stream.errors.full_messages.join(", ")
        end
      end

      def destroy
        Stream.find(params[:id]).destroy
        render json: { ok: true }
      end

      private

      def stream_params
        permitted = params.permit(:name, :nickname, :key, :enabled, :note, :visibility, :ownerId, sharedWith: [])
        permitted.to_h.transform_keys { |k| { "ownerId" => "owner_id", "sharedWith" => "shared_with" }.fetch(k, k) }
      end
    end
  end
end
