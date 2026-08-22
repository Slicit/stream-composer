require "rails_helper"

RSpec.describe Session, type: :model do
  let!(:user) { User.create!(username: "session-owner", password: "correct-horse-1", role: "viewer") }

  describe ".authenticate" do
    it "returns the session for a valid, unexpired raw token" do
      session = Session.start_for(user)
      found = Session.authenticate(session.raw_token)
      expect(found).to eq(session)
    end

    it "returns nil for an unknown token" do
      expect(Session.authenticate("not-a-real-token")).to be_nil
    end

    it "returns nil and deletes the session once it has expired" do
      session = Session.start_for(user)
      session.update!(expires_at: 1.minute.ago)
      expect(Session.authenticate(session.raw_token)).to be_nil
      expect(Session.exists?(session.id)).to be false
    end
  end

  describe ".authenticate_by_digest" do
    it "returns the session for the token's own digest" do
      session = Session.start_for(user)
      found = Session.authenticate_by_digest(Session.digest(session.raw_token))
      expect(found).to eq(session)
    end

    it "SECURITY: does not authenticate the raw token itself, only its digest" do
      session = Session.start_for(user)
      expect(Session.authenticate_by_digest(session.raw_token)).to be_nil
    end

    it "returns nil for an unknown digest" do
      expect(Session.authenticate_by_digest(Session.digest("nope"))).to be_nil
    end

    it "returns nil and deletes the session once it has expired" do
      session = Session.start_for(user)
      session.update!(expires_at: 1.minute.ago)
      digest = Session.digest(session.raw_token)
      expect(Session.authenticate_by_digest(digest)).to be_nil
      expect(Session.exists?(session.id)).to be false
    end
  end
end
