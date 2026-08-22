require "rails_helper"

RSpec.describe Stream, type: :model do
  def build_stream(**attrs)
    Stream.new({ name: "Camera 1" }.merge(attrs))
  end

  describe "defaults and generated fields" do
    it "generates a key and a playback id when none is given" do
      stream = build_stream.tap(&:save!)
      expect(stream.key).to match(Stream::KEY_FORMAT)
      expect(stream.playback_id).to be_present
    end

    it "defaults to private" do
      expect(build_stream.tap(&:save!).visibility).to eq("private")
    end

    it "keeps a caller-supplied key" do
      stream = build_stream(key: "my-custom-key-000000").tap(&:save!)
      expect(stream.key).to eq("my-custom-key-000000")
    end
  end

  describe "validations" do
    it "requires a name of at most 48 characters" do
      expect(build_stream(name: "")).not_to be_valid
      expect(build_stream(name: "x" * 49)).not_to be_valid
    end

    it "rejects a key that is not unique" do
      build_stream(key: "duplicate-key-000000").save!
      expect(build_stream(key: "duplicate-key-000000")).not_to be_valid
    end

    it "rejects a malformed key" do
      expect(build_stream(key: "!!!")).not_to be_valid
    end

    it "rejects a visibility other than public or private" do
      expect(build_stream(visibility: "unlisted")).not_to be_valid
    end

    it "requires shared_with entries to reference real users" do
      expect(build_stream(shared_with: [SecureRandom.uuid])).not_to be_valid
    end

    it "accepts shared_with entries that reference real users" do
      user = User.create!(username: "granted", password: "correct-horse-1", role: "viewer")
      expect(build_stream(shared_with: [user.id])).to be_valid
    end
  end

  describe "#accessible_to?" do
    let(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
    let(:owner) { User.create!(username: "owner-1", password: "correct-horse-1", role: "streamer") }
    let(:granted) { User.create!(username: "granted-1", password: "correct-horse-1", role: "viewer") }
    let(:stranger) { User.create!(username: "stranger-1", password: "correct-horse-1", role: "viewer") }

    it "is open to anyone, including anonymous, when public" do
      stream = build_stream(visibility: "public")
      expect(stream.accessible_to?(nil)).to be true
      expect(stream.accessible_to?(stranger)).to be true
    end

    it "refuses anonymous and a stranger when private" do
      stream = build_stream(visibility: "private", owner: owner, shared_with: [granted.id])
      expect(stream.accessible_to?(nil)).to be false
      expect(stream.accessible_to?(stranger)).to be false
    end

    it "admits the owner, an explicitly granted user, and any admin" do
      stream = build_stream(visibility: "private", owner: owner, shared_with: [granted.id])
      expect(stream.accessible_to?(owner)).to be true
      expect(stream.accessible_to?(granted)).to be true
      expect(stream.accessible_to?(admin)).to be true
    end
  end
end
