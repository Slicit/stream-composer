require "rails_helper"

RSpec.describe "Api::StreamsAvailable", type: :request do
  let!(:granted) { User.create!(username: "granted-1", password: "correct-horse-1", role: "viewer") }
  let!(:stranger) { User.create!(username: "stranger-1", password: "correct-horse-1", role: "viewer") }
  let!(:public_stream) { Stream.create!(name: "Public cam", visibility: "public") }
  let!(:private_stream) { Stream.create!(name: "Private cam", visibility: "private", shared_with: [granted.id]) }

  it "refuses an anonymous caller" do
    get "/api/streams/available", as: :json
    expect(response).to have_http_status(:unauthorized)
  end

  it "includes the public stream and the private one the caller is granted, but not one they are not" do
    sign_in_as(granted, password: "correct-horse-1")
    get "/api/streams/available", as: :json
    ids = JSON.parse(response.body)["streams"].map { |s| s["id"] }
    expect(ids).to include(public_stream.id, private_stream.id)
  end

  it "SECURITY: a stranger does not see the private stream" do
    sign_in_as(stranger, password: "correct-horse-1")
    get "/api/streams/available", as: :json
    ids = JSON.parse(response.body)["streams"].map { |s| s["id"] }
    expect(ids).to include(public_stream.id)
    expect(ids).not_to include(private_stream.id)
  end
end
