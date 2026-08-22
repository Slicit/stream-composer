module Api
  # The pool of streams a signed-in user may build a channel from: every
  # public stream, plus every private one they can already reach (owner,
  # explicitly granted, or admin). Mirrors
  # server/src/routes/channels.js's GET /api/streams/available.
  class StreamsAvailableController < ApplicationController
    before_action :require_user!

    def index
      available = Stream.all.select { |s| s.accessible_to?(current_user) }
      render json: { streams: available.map { |s| { id: s.id, name: s.name, nickname: s.nickname, visibility: s.visibility } } }
    end
  end
end
