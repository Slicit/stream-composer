class ApplicationController < ActionController::API
  include ActionController::Cookies

  SESSION_COOKIE = "sc_session"

  rescue_from ActiveRecord::RecordNotFound, with: :render_not_found
  rescue_from ActiveRecord::RecordInvalid, with: :render_unprocessable

  private

  def current_session
    return @current_session if defined?(@current_session)
    @current_session = Session.authenticate(cookies[SESSION_COOKIE])
  end

  def current_user
    return @current_user if defined?(@current_user)
    @current_user = current_session&.user
  end

  def require_user!
    render_unauthorized("Sign in to continue.") unless current_user
  end

  def require_admin!
    return require_user! unless current_user
    render_forbidden("Administrator access is required.") unless current_user.role == "admin"
  end

  def require_streamer_or_admin!
    return require_user! unless current_user
    unless %w[admin streamer].include?(current_user.role)
      render_forbidden("Streamer access is required.")
    end
  end

  def require_compositor_access!
    return require_user! unless current_user
    render_forbidden("Compositor access is required.") unless current_user.compositor_quota.positive? || current_user.role == "admin"
  end

  def sign_in(user, impersonator: nil)
    session = Session.start_for(user, impersonator: impersonator)
    cookies[SESSION_COOKIE] = {
      value: session.raw_token,
      httponly: true,
      same_site: :lax,
      secure: Rails.env.production?,
      expires: Session::TTL.from_now,
    }
    session
  end

  def sign_out
    Session.authenticate(cookies[SESSION_COOKIE])&.destroy
    cookies.delete(SESSION_COOKIE)
  end

  def render_error(status, message)
    render json: { error: message }, status: status
  end

  def render_not_found(err = nil)
    render_error :not_found, err&.message || "Not found."
  end

  def render_unprocessable(err)
    render_error :bad_request, err.record.errors.full_messages.join(", ")
  end

  def render_unauthorized(message)
    render_error :unauthorized, message
  end

  def render_forbidden(message)
    render_error :forbidden, message
  end
end
