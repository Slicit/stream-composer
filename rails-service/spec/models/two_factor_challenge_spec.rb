require "rails_helper"

RSpec.describe TwoFactorChallenge, type: :model do
  let!(:user) { User.create!(username: "challenge-owner", password: "correct-horse-1", role: "viewer") }

  describe ".authenticate" do
    it "returns the challenge for a valid, unexpired raw token" do
      challenge = TwoFactorChallenge.start_for(user)
      found = TwoFactorChallenge.authenticate(challenge.raw_token)
      expect(found).to eq(challenge)
    end

    it "returns nil for an unknown token" do
      expect(TwoFactorChallenge.authenticate("not-a-real-token")).to be_nil
    end

    it "returns nil and deletes the challenge once it has expired" do
      challenge = TwoFactorChallenge.start_for(user)
      challenge.update!(expires_at: 1.minute.ago)
      expect(TwoFactorChallenge.authenticate(challenge.raw_token)).to be_nil
      expect(TwoFactorChallenge.exists?(challenge.id)).to be false
    end

    it "SECURITY: never stores the raw token, only its digest" do
      challenge = TwoFactorChallenge.start_for(user)
      expect(challenge.reload.token_digest).not_to eq(challenge.raw_token)
      expect(challenge.token_digest).to eq(TwoFactorChallenge.digest(challenge.raw_token))
    end
  end
end
