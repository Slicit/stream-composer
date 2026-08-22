# Shared gate for every internal/* controller: the Go data plane's shared
# secret travels in the URL (it cannot send custom headers to itself
# consistently across the auth-hook and internal-API call sites), so this
# is the one check standing between "server-to-server" and "the internet."
module InternalTokenAuthenticatable
  extend ActiveSupport::Concern

  included do
    before_action :verify_token!
  end

  private

  def verify_token!
    expected = ENV["INTERNAL_API_TOKEN"]
    if expected.blank?
      Rails.logger.error("INTERNAL_API_TOKEN is not set — refusing every internal API request")
      return render(json: { error: "not configured" }, status: :unauthorized)
    end
    return if ActiveSupport::SecurityUtils.secure_compare(params[:token].to_s, expected)

    render json: { error: "Not found." }, status: :not_found
  end
end
