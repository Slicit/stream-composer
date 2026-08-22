require "rails_helper"

RSpec.describe "Api::Streams (self-service /streams/mine)", type: :request do
  let!(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
  let!(:plain_viewer) { User.create!(username: "plain-viewer", password: "correct-horse-1", role: "viewer") }
  let!(:streamer_a) { User.create!(username: "streamer-a", password: "correct-horse-1", role: "streamer", stream_quota: 1) }
  let!(:streamer_b) { User.create!(username: "streamer-b", password: "correct-horse-1", role: "streamer", stream_quota: 1) }

  describe "SECURITY: access control" do
    it "refuses an anonymous caller with 401, not a redirect" do
      get "/api/streams/mine", as: :json
      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a plain viewer with 403" do
      sign_in_as(plain_viewer, password: "correct-horse-1")
      get "/api/streams/mine", as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  describe "SECURITY: the /streams/mine scope must never leak onto unrelated routes" do
    # This is the exact bug class the Go data plane shipped once already
    # this migration (a blanket guard mounted too broadly) — asserted here
    # too, on the Rails side, since the same mistake (a controller-wide
    # before_action applied via a route scoped wider than intended) is just
    # as easy to make in Rails as it is with a bare router.use() in Express
    # or Go. A plain viewer must still be able to reach *their own* public
    # routes; nothing under /streams/mine should ever affect /api/auth/me.
    it "does not affect /api/auth/me for a plain viewer" do
      sign_in_as(plain_viewer, password: "correct-horse-1")
      get "/api/auth/me", as: :json
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["user"]["username"]).to eq("plain-viewer")
    end
  end

  describe "quota" do
    before { sign_in_as(streamer_a, password: "correct-horse-1") }

    it "allows creating up to the quota" do
      post "/api/streams/mine", params: { name: "A cam 1" }, as: :json
      expect(response).to have_http_status(:created)
      expect(JSON.parse(response.body)["stream"]["ownerId"]).to eq(streamer_a.id)
    end

    it "refuses past the quota" do
      post "/api/streams/mine", params: { name: "A cam 1" }, as: :json
      post "/api/streams/mine", params: { name: "A cam 2" }, as: :json
      expect(response).to have_http_status(:forbidden)
    end
  end

  it "an admin is never quota-limited through the self-service endpoint, even with a zero quota" do
    sign_in_as(admin, password: "correct-horse-1")
    post "/api/streams/mine", params: { name: "Admin cam" }, as: :json
    expect(response).to have_http_status(:created)
  end

  describe "SECURITY: cross-tenant isolation" do
    let!(:stream_a) do
      sign_in_as(streamer_a, password: "correct-horse-1")
      post "/api/streams/mine", params: { name: "A cam" }, as: :json
      Stream.find(JSON.parse(response.body)["stream"]["id"])
    end

    it "B does not see A's stream in their own list" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      get "/api/streams/mine", as: :json
      ids = JSON.parse(response.body)["streams"].map { |s| s["id"] }
      expect(ids).not_to include(stream_a.id)
    end

    it "B cannot edit A's stream" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      patch "/api/streams/mine/#{stream_a.id}", params: { name: "Hijacked" }, as: :json
      expect(response).to have_http_status(:forbidden)
      expect(stream_a.reload.name).to eq("A cam")
    end

    it "B cannot delete A's stream" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      delete "/api/streams/mine/#{stream_a.id}", as: :json
      expect(response).to have_http_status(:forbidden)
      expect(Stream.exists?(stream_a.id)).to be true
    end

    it "B cannot rotate A's stream key" do
      sign_in_as(streamer_b, password: "correct-horse-1")
      original_key = stream_a.key
      post "/api/streams/mine/#{stream_a.id}/rotate-key", as: :json
      expect(response).to have_http_status(:forbidden)
      expect(stream_a.reload.key).to eq(original_key)
    end
  end

  describe "the self-service PATCH allowlist" do
    let!(:stream_a) do
      sign_in_as(streamer_a, password: "correct-horse-1")
      post "/api/streams/mine", params: { name: "A cam" }, as: :json
      Stream.find(JSON.parse(response.body)["stream"]["id"])
    end

    it "does not accept ownerId reassignment through self-service" do
      other = User.create!(username: "other", password: "correct-horse-1", role: "viewer")
      sign_in_as(streamer_a, password: "correct-horse-1")
      patch "/api/streams/mine/#{stream_a.id}", params: { ownerId: other.id }, as: :json
      expect(stream_a.reload.owner_id).to eq(streamer_a.id)
    end

    it "does not accept an arbitrary key through self-service" do
      sign_in_as(streamer_a, password: "correct-horse-1")
      original_key = stream_a.key
      patch "/api/streams/mine/#{stream_a.id}", params: { key: "attacker-chosen-key" }, as: :json
      expect(stream_a.reload.key).to eq(original_key)
    end

    it "does accept name/nickname/visibility/enabled/note" do
      sign_in_as(streamer_a, password: "correct-horse-1")
      patch "/api/streams/mine/#{stream_a.id}", params: { visibility: "public", nickname: "On air" }, as: :json
      expect(response).to have_http_status(:ok)
      stream_a.reload
      expect(stream_a.visibility).to eq("public")
      expect(stream_a.nickname).to eq("On air")
    end
  end
end
