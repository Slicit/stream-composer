require "rails_helper"

RSpec.describe User, type: :model do
  def build_user(**attrs)
    User.new({ username: "tester", password: "correct-horse-1", role: "viewer" }.merge(attrs))
  end

  describe "scrypt compatibility with the Node backend" do
    it "produces the exact same hash server/src/auth.js's hashPassword() does for the same inputs" do
      # Cross-checked directly: `crypto.scryptSync("pw", "s".repeat(16), 64,
      # {N:16384,r:8,p:1}).toString("hex")` in Node produces this exact
      # string — pinned here so nobody accidentally changes the KDF
      # parameters and silently breaks the config.json -> Postgres password
      # migration.
      expected = "6c41671bbce8277ecd40b1f32c1e29a4c1b9bee10d2d46f32dccf4528bde764" \
                 "8b84882984be7d5702c9d0e32631ccbe54925e0a7bca049177a76ce4be5069f0f"
      expect(User.scrypt_hex("pw", "s" * 16)).to eq(expected)
    end
  end

  describe "validations" do
    it "accepts a well-formed username" do
      expect(build_user(username: "camera-1")).to be_valid
    end

    it "rejects a username that is too short" do
      expect(build_user(username: "a")).not_to be_valid
    end

    it "rejects a username with disallowed characters" do
      expect(build_user(username: "has spaces")).not_to be_valid
    end

    it "treats usernames as case-insensitively unique" do
      build_user(username: "Camera").save!
      expect(build_user(username: "camera")).not_to be_valid
    end

    it "requires a role of admin, viewer or streamer" do
      user = build_user
      user.role = "root"
      expect(user).not_to be_valid
    end

    it "clamps stream_quota to 0..1000" do
      expect(build_user(stream_quota: -1)).not_to be_valid
      expect(build_user(stream_quota: 1001)).not_to be_valid
      expect(build_user(stream_quota: 5)).to be_valid
    end

    it "requires a password on create" do
      user = User.new(username: "nopass", role: "viewer")
      expect(user).not_to be_valid
      expect(user.errors[:password]).not_to be_empty
    end

    it "rejects a short password" do
      expect(build_user(password: "short")).not_to be_valid
    end

    it "rejects a password with leading or trailing whitespace" do
      expect(build_user(password: " leading-space-1")).not_to be_valid
    end
  end

  describe "authentication" do
    let!(:user) { build_user(username: "alice", password: "correct-horse-1").tap(&:save!) }

    it "authenticates the right password" do
      expect(User.authenticate_credentials("alice", "correct-horse-1")).to eq(user)
    end

    it "is case-insensitive on the username" do
      expect(User.authenticate_credentials("ALICE", "correct-horse-1")).to eq(user)
    end

    it "refuses the wrong password" do
      expect(User.authenticate_credentials("alice", "wrong-password")).to be_nil
    end

    it "refuses an unknown username without raising" do
      expect(User.authenticate_credentials("nobody", "whatever1")).to be_nil
    end
  end

  describe ".import_legacy!" do
    it "rebuilds a user from an already-hashed record and can still authenticate with the original password" do
      hash = User.scrypt_hex("original-password-1", "existing-salt-value")
      user = User.import_legacy!(
        id: SecureRandom.uuid, username: "legacy-user", role: "viewer", stream_quota: 0,
        salt: "existing-salt-value", password_hash: hash, created_at: 3.years.ago, last_login_at: nil,
      )
      expect(User.authenticate_credentials("legacy-user", "original-password-1")).to eq(user)
    end
  end

  describe ".ensure_bootstrap_admin!" do
    it "does nothing when a user already exists" do
      build_user.save!
      expect { User.ensure_bootstrap_admin! }.not_to change(User, :count)
    end

    it "creates an admin from ADMIN_USER/ADMIN_PASSWORD when the install is empty" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ADMIN_USER").and_return("bootstrapped")
      allow(ENV).to receive(:[]).with("ADMIN_PASSWORD").and_return("correct-horse-1")

      user = User.ensure_bootstrap_admin!
      expect(user.username).to eq("bootstrapped")
      expect(user.role).to eq("admin")
      expect(User.authenticate_credentials("bootstrapped", "correct-horse-1")).to eq(user)
    end

    it "generates a password when ADMIN_PASSWORD is unset or too weak" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ADMIN_PASSWORD").and_return(nil)

      user = User.ensure_bootstrap_admin!
      expect(user).to be_persisted
      expect(user.role).to eq("admin")
    end

    it "falls back to a valid username when ADMIN_USER is malformed" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ADMIN_USER").and_return("not a valid username!!")

      user = User.ensure_bootstrap_admin!
      expect(user.username).to eq("admin")
    end
  end

  describe "the admin role immutability guard" do
    it "refuses to change the role of the sole remaining admin" do
      admin = build_user(username: "solo-admin", role: "admin").tap(&:save!)
      admin.role = "viewer"
      expect(admin).not_to be_valid
      expect(admin.errors[:role]).not_to be_empty
    end

    it "refuses to change an admin's role even when another admin still exists" do
      build_user(username: "admin-one", role: "admin").save!
      admin_two = build_user(username: "admin-two", role: "admin").tap(&:save!)
      admin_two.role = "viewer"
      expect(admin_two).not_to be_valid
      expect(admin_two.errors[:role]).not_to be_empty
    end

    it "refuses to delete the sole remaining admin" do
      admin = build_user(username: "solo-admin", role: "admin").tap(&:save!)
      expect(admin.destroy).to be false
      expect(User.exists?(admin.id)).to be true
    end

    it "allows deleting an admin when another admin still exists" do
      build_user(username: "admin-one", role: "admin").save!
      admin_two = build_user(username: "admin-two", role: "admin").tap(&:save!)
      expect(admin_two.destroy).to be_truthy
    end
  end
end
