require "rails_helper"

RSpec.describe Channel, type: :model do
  let!(:owner) { User.create!(username: "owner-1", password: "correct-horse-1", role: "viewer") }

  def build_channel(**attrs)
    Channel.new({ name: "Main Stage", owner: owner }.merge(attrs))
  end

  describe "slugs" do
    it "auto-generates a slug from the name" do
      expect(build_channel.tap(&:save!).slug).to eq("main-stage")
    end

    it "auto-generates a unique slug on collision" do
      build_channel(name: "Main Stage!!").save!
      second = build_channel(name: "Main Stage!!").tap(&:save!)
      expect(second.slug).to eq("main-stage-2")
    end

    it "rejects a manual slug that is already in use" do
      build_channel(slug: "taken").save!
      expect(build_channel(slug: "taken")).not_to be_valid
    end

    it "rejects a malformed manual slug" do
      expect(build_channel(slug: "Not Valid!")).not_to be_valid
    end

    it "defaults to private" do
      expect(build_channel.tap(&:save!).visibility).to eq("private")
    end
  end

  describe "stream_ids" do
    it "accepts ids that reference real streams" do
      stream = Stream.create!(name: "Cam")
      expect(build_channel(stream_ids: [stream.id])).to be_valid
    end

    it "rejects an id that does not reference a real stream" do
      expect(build_channel(stream_ids: [SecureRandom.uuid])).not_to be_valid
    end
  end

  describe "#accessible_to? (via Accessible)" do
    let(:admin) { User.create!(username: "admin-1", password: "correct-horse-1", role: "admin") }
    let(:granted) { User.create!(username: "granted-1", password: "correct-horse-1", role: "viewer") }
    let(:stranger) { User.create!(username: "stranger-1", password: "correct-horse-1", role: "viewer") }

    it "a private channel admits only the owner, an explicitly granted user, or an admin" do
      channel = build_channel(visibility: "private", shared_with: [granted.id]).tap(&:save!)
      expect(channel.accessible_to?(nil)).to be false
      expect(channel.accessible_to?(stranger)).to be false
      expect(channel.accessible_to?(owner)).to be true
      expect(channel.accessible_to?(granted)).to be true
      expect(channel.accessible_to?(admin)).to be true
    end
  end

  describe "description, current_topic and featured_game" do
    it "defaults description and current_topic to empty strings" do
      channel = build_channel.tap(&:save!)
      expect(channel.description).to eq("")
      expect(channel.current_topic).to eq("")
      expect(channel.featured_game).to be_nil
    end

    it "rejects a current_topic longer than 255 characters" do
      expect(build_channel(current_topic: "a" * 256)).not_to be_valid
    end

    it "accepts a current_topic at exactly 255 characters" do
      expect(build_channel(current_topic: "a" * 255)).to be_valid
    end

    it "rejects a description longer than 500 characters" do
      expect(build_channel(description: "a" * 501)).not_to be_valid
    end

    it "associates with a real game and serializes its name" do
      game = Game.create!(name: "Stardew Valley")
      channel = build_channel(featured_game: game).tap(&:save!)
      expect(channel.as_public_json[:featuredGameId]).to eq(game.id)
      expect(channel.as_public_json[:featuredGameName]).to eq("Stardew Valley")
    end

    it "leaves featured_game nil when unset, without erroring the serializer" do
      channel = build_channel.tap(&:save!)
      expect(channel.as_public_json[:featuredGameId]).to be_nil
      expect(channel.as_public_json[:featuredGameName]).to be_nil
    end
  end

  describe "layout_mode" do
    it "defaults to nil (inherit the site default)" do
      expect(build_channel.tap(&:save!).layout_mode).to be_nil
    end

    it "accepts fixed or maximize" do
      expect(build_channel(layout_mode: "fixed")).to be_valid
      expect(build_channel(layout_mode: "maximize")).to be_valid
    end

    it "rejects anything else" do
      expect(build_channel(layout_mode: "bogus")).not_to be_valid
    end
  end

  describe "deleting a channel" do
    it "clears itself as the homepage channel" do
      channel = build_channel.tap(&:save!)
      AppSetting.instance.update!(homepage_channel_id: channel.id)
      channel.destroy
      expect(AppSetting.instance.homepage_channel_id).to be_nil
    end

    it "leaves an unrelated homepage channel alone" do
      channel = build_channel.tap(&:save!)
      other = build_channel(name: "Other").tap(&:save!)
      AppSetting.instance.update!(homepage_channel_id: other.id)
      channel.destroy
      expect(AppSetting.instance.homepage_channel_id).to eq(other.id)
    end
  end
end
