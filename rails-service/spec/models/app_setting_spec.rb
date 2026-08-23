require "rails_helper"

RSpec.describe AppSetting, type: :model do
  it "defaults to fixed layout mode" do
    expect(AppSetting.instance.default_layout_mode).to eq("fixed")
  end

  it "rejects an invalid layout mode" do
    expect(AppSetting.instance.tap { |s| s.default_layout_mode = "bogus" }).not_to be_valid
  end

  it "serializes both settings" do
    setting = AppSetting.instance
    setting.update!(default_layout_mode: "maximize", public_viewing: true)
    expect(setting.as_public_json).to eq({ defaultLayoutMode: "maximize", publicViewing: true })
  end
end
