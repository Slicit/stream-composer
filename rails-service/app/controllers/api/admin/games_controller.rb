module Api
  module Admin
    # Manages the Game catalog (see app/models/game.rb) — name only for
    # now, same "unblock the picker, not a game database" scope as the
    # model itself. Deleting a game just clears it from any channel that
    # had it featured (channels.featured_game_id on_delete: :nullify);
    # nothing here needs to guard against that.
    class GamesController < ApplicationController
      before_action :require_admin!

      def index
        render json: { games: Game.order(:name).map(&:as_public_json) }
      end

      def create
        game = Game.new(params.permit(:name))
        if game.save
          render json: { game: game.as_public_json }, status: :created
        else
          render_error :bad_request, game.errors.full_messages.join(", ")
        end
      end

      def update
        game = Game.find(params[:id])
        if game.update(params.permit(:name))
          render json: { game: game.as_public_json }
        else
          render_error :bad_request, game.errors.full_messages.join(", ")
        end
      end

      def destroy
        Game.find(params[:id]).destroy
        render json: { ok: true }
      end
    end
  end
end
