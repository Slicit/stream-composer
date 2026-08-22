require "net/http"

module Api
  module Admin
    # Proxies the Go data plane's internal status/bandwidth-history
    # endpoints for the admin Server & Stats page. The browser never talks
    # to the data plane's /internal/* routes directly — see that route's
    # own comment in cmd/dataplane/main.go: "the admin console (via Rails)
    # is the only intended caller." Plain Net::HTTP rather than a new gem:
    # two proxied GETs isn't worth a dependency.
    class StatsController < ApplicationController
      before_action :require_admin!

      TIMEOUT_SECONDS = 3

      # Host/CPU/memory, MediaMTX reachability, relay/audio-monitor
      # summaries, and the data plane's own uptime — one call.
      def status
        proxy("status")
      end

      # The 7-day inbound/outbound bandwidth trend for the chart.
      def bandwidth_history
        proxy("bandwidth-history")
      end

      private

      def proxy(path)
        uri = URI.parse("#{ENV.fetch('DATAPLANE_INTERNAL_URL')}/internal/#{ENV.fetch('INTERNAL_SECRET')}/#{path}")
        http = Net::HTTP.new(uri.host, uri.port)
        http.open_timeout = TIMEOUT_SECONDS
        http.read_timeout = TIMEOUT_SECONDS
        response = http.get(uri.request_uri)

        return render_error(:bad_gateway, "The data plane did not respond.") unless response.is_a?(Net::HTTPSuccess)

        render json: JSON.parse(response.body)
      rescue StandardError => e
        render_error(:bad_gateway, "Could not reach the data plane: #{e.message}")
      end
    end
  end
end
