require "rails_helper"

RSpec.describe UserMailer, type: :mailer do
  describe "#confirmation_email" do
    let(:user) { User.create!(username: "mailee", email: "mailee@example.com", password: "correct-horse-1", role: "viewer") }
    let(:mail) { UserMailer.confirmation_email(user, "the-raw-token") }

    it "addresses and subjects the mail correctly" do
      expect(mail.to).to eq(["mailee@example.com"])
      expect(mail.subject).to eq("Confirm your Stream Composer account")
    end

    it "includes the confirm-email URL with the raw token in both bodies" do
      expect(mail.text_part.body.to_s).to include("/confirm-email?token=the-raw-token")
      expect(mail.html_part.body.to_s).to include("/confirm-email?token=the-raw-token")
    end
  end
end
