module Api
  module Admin
    # The site-wide settings singleton (see AppSetting) — currently the
    # default grid layout mode new channels inherit, and whether an
    # anonymous visitor may watch at all. GET/PATCH only: there is exactly
    # one row, so "CRUD" here means "show and update it," not a list.
    class SettingsController < ApplicationController
      before_action :require_admin!

      def show
        render json: { settings: AppSetting.instance.as_public_json }
      end

      def update
        setting = AppSetting.instance
        body = params.permit(:defaultLayoutMode, :publicViewing)
        attrs = body.to_h.transform_keys { |k| { "defaultLayoutMode" => "default_layout_mode", "publicViewing" => "public_viewing" }.fetch(k, k) }
        if setting.update(attrs)
          render json: { settings: setting.as_public_json }
        else
          render_error :bad_request, setting.errors.full_messages.join(", ")
        end
      end
    end
  end
end
