require "rails_helper"

RSpec.describe "Internal::Sessions", type: :request do
  let!(:user) { User.create!(username: "internal-session-user", password: "correct-horse-1", role: "streamer", stream_quota: 3) }

  around do |example|
    original = ENV["INTERNAL_API_TOKEN"]
    ENV["INTERNAL_API_TOKEN"] = "test-internal-secret"
    example.run
    ENV["INTERNAL_API_TOKEN"] = original
  end

  it "SECURITY: refuses a request with the wrong token" do
    get "/internal/wrong-token/sessions/#{Session.digest('irrelevant')}", as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "SECURITY: refuses every request when no token is configured" do
    ENV["INTERNAL_API_TOKEN"] = nil
    get "/internal/test-internal-secret/sessions/#{Session.digest('irrelevant')}", as: :json
    expect(response).to have_http_status(:unauthorized)
  end

  it "resolves a valid session's digest to its user's id and role" do
    session = Session.start_for(user)
    get "/internal/test-internal-secret/sessions/#{Session.digest(session.raw_token)}", as: :json
    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq({ "id" => user.id, "role" => "streamer" })
  end

  it "returns 404 for an unknown digest" do
    get "/internal/test-internal-secret/sessions/#{Session.digest('never-issued')}", as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "SECURITY: does not resolve a raw token sent where a digest is expected" do
    session = Session.start_for(user)
    get "/internal/test-internal-secret/sessions/#{session.raw_token}", as: :json
    expect(response).to have_http_status(:not_found)
  end

  it "returns 404 for an expired session and it no longer resolves afterward" do
    session = Session.start_for(user)
    session.update!(expires_at: 1.minute.ago)
    digest = Session.digest(session.raw_token)

    get "/internal/test-internal-secret/sessions/#{digest}", as: :json
    expect(response).to have_http_status(:not_found)
    expect(Session.exists?(session.id)).to be false
  end
end
