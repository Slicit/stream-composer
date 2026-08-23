module Api
  # The featured-game picker's option list — every signed-in user may see
  # it, same gate as GET /api/channels (any signed-in user can build or
  # view a channel, not just admins).
  class GamesController < ApplicationController
    before_action :require_user!

    def index
      render json: { games: Game.order(:name).map(&:as_public_json) }
    end
  end
end
