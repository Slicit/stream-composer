require "rails_helper"

RSpec.describe "Api::Admin::Stats", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:viewer) { User.create!(username: "viewer-1", password: "correct-horse-1", role: "viewer") }

  around do |example|
    original_url, original_secret = ENV["DATAPLANE_INTERNAL_URL"], ENV["INTERNAL_SECRET"]
    ENV["DATAPLANE_INTERNAL_URL"] = "http://dataplane:8080"
    ENV["INTERNAL_SECRET"] = "test-secret"
    example.run
    ENV["DATAPLANE_INTERNAL_URL"], ENV["INTERNAL_SECRET"] = original_url, original_secret
  end

  # No webmock/VCR in this app (see Gemfile) — a plain double over
  # Net::HTTP is enough for two proxied GETs, matching the controller's
  # own "not worth a dependency" choice.
  def stub_dataplane(body:, success: true)
    response = double("response", body: body.to_json)
    allow(response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(success)
    http = double("http")
    allow(http).to receive(:open_timeout=)
    allow(http).to receive(:read_timeout=)
    allow(http).to receive(:get).and_return(response)
    allow(Net::HTTP).to receive(:new).and_return(http)
  end

  describe "SECURITY: access control" do
    it "refuses an anonymous caller" do
      get "/api/admin/stats/status", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a signed-in viewer" do
      sign_in_as(viewer, password: "correct-horse-1")
      get "/api/admin/stats/status", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "as an admin" do
    before { sign_in_as(admin, password: "correct-horse-1") }

    it "proxies GET /internal/{secret}/status" do
      stub_dataplane(body: { host: { cpuPercent: 12.3 } })
      get "/api/admin/stats/status", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["host"]["cpuPercent"]).to eq(12.3)
    end

    it "proxies GET /internal/{secret}/bandwidth-history" do
      stub_dataplane(body: [{ at: "2026-01-01T00:00:00Z", inboundKbps: 100, outboundKbps: 50 }])
      get "/api/admin/stats/bandwidth-history", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body).first["inboundKbps"]).to eq(100)
    end

    it "returns a bad gateway when the data plane does not respond successfully" do
      stub_dataplane(body: { error: "nope" }, success: false)
      get "/api/admin/stats/status", as: :json
      expect(response).to have_http_status(:bad_gateway)
    end

    it "returns a bad gateway when the data plane is unreachable" do
      allow(Net::HTTP).to receive(:new).and_raise(SocketError, "could not resolve host")
      get "/api/admin/stats/status", as: :json
      expect(response).to have_http_status(:bad_gateway)
    end
  end
end
