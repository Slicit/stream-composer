module AuthHelpers
  # Logs the given user in for the rest of this example — the integration
  # session keeps the sc_session cookie automatically, the same way a real
  # browser would, so every subsequent request in the example runs as them.
  def sign_in_as(user, password:)
    post "/api/auth/login", params: { username: user.username, password: password }, as: :json
    raise "sign_in_as failed: #{response.status} #{response.body}" unless response.status == 200
  end
end

RSpec.configure do |config|
  config.include AuthHelpers, type: :request
end
