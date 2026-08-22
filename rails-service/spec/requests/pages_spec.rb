require "rails_helper"

RSpec.describe "PagesController (React SPA fallback)", type: :request do
  it "serves index.html for the root path" do
    get "/"
    expect(response).to have_http_status(:ok)
    expect(response.content_type).to include("text/html")
    expect(response.body).to include("<html")
  end

  it "serves index.html for a client-side route, so a hard refresh works" do
    get "/admin/streams"
    expect(response).to have_http_status(:ok)
    expect(response.content_type).to include("text/html")
  end

  it "serves index.html for a channel viewer route" do
    get "/c/some-channel"
    expect(response).to have_http_status(:ok)
  end

  it "does not shadow a real /api route" do
    get "/api/auth/me"
    expect(response).to have_http_status(:ok)
    expect(response.content_type).to include("application/json")
  end

  it "does not shadow a real /internal route" do
    get "/internal/wrong-token/streams", as: :json
    expect(response).to have_http_status(:not_found)
    expect(response.content_type).to include("application/json")
  end
end
