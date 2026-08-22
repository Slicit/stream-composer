module Internal
  # Lets the Go data plane resolve a caller's sc_session cookie without
  # holding its own copy of the sessions table. The Go side sends only the
  # token's SHA-256 digest (the same value Session itself stores), never
  # the raw cookie token — a leaked request or log line here is useless to
  # replay, the same property Session.digest already gives the database
  # itself against a leak.
  class SessionsController < ActionController::API
    include InternalTokenAuthenticatable

    def show
      session = Session.authenticate_by_digest(params[:digest])
      return render(json: { error: "Not found." }, status: :not_found) unless session

      render json: { id: session.user.id, role: session.user.role }
    end
  end
end
