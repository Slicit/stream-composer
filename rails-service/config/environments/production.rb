require "active_support/core_ext/integer/time"

Rails.application.configure do
  # Settings specified here will take precedence over those in config/application.rb.

  # Code is not reloaded between requests.
  config.enable_reloading = false

  # Eager load code on boot for better performance and memory savings (ignored by Rake tasks).
  config.eager_load = true

  # Full error reports are disabled.
  config.consider_all_requests_local = false

  # Serves the built React SPA (copied into public/ at image build time —
  # see Dockerfile) and channel background uploads. Rails' own static file
  # server, not a separate container: same origin as the API, no CORS/
  # SameSite story needed for sc_session in production either.
  config.public_file_server.enabled = true
  # Cache assets for far-future expiry since they are all digest stamped.
  # Uploaded backgrounds are not digest-stamped (see Api::ChannelsController
  # #background), so this header would tell a browser to cache a replaced
  # image under its old bytes — scoped to the SPA's own hashed filenames only.
  config.public_file_server.headers = { "cache-control" => "public, max-age=#{1.year.to_i}" }

  # Traefik (docker-compose.go-rails-react.tls.yml) is the only entry point
  # in this deployment and always terminates TLS — trust its assertion and
  # enforce HTTPS/secure cookies/HSTS here rather than making it optional.
  config.assume_ssl = true
  config.force_ssl = true

  # Skip http-to-https redirect for the default health check endpoint.
  # config.ssl_options = { redirect: { exclude: ->(request) { request.path == "/up" } } }

  # Log to STDOUT with the current request id as a default log tag.
  config.log_tags = [ :request_id ]
  config.logger   = ActiveSupport::TaggedLogging.logger(STDOUT)

  # Change to "debug" to log everything (including potentially personally-identifiable information!).
  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")

  # Prevent health checks from clogging up the logs.
  config.silence_healthcheck_path = "/up"

  # Don't log any deprecations.
  config.active_support.report_deprecations = false

  # Replace the default in-process memory cache store with a durable alternative.
  # config.cache_store = :mem_cache_store

  # Replace the default in-process and non-durable queuing backend for Active Job.
  # config.active_job.queue_adapter = :resque

  # Enable locale fallbacks for I18n (makes lookups for any locale fall back to
  # the I18n.default_locale when a translation cannot be found).
  config.i18n.fallbacks = true

  # Do not dump schema after migrations.
  config.active_record.dump_schema_after_migration = false

  # Only use :id for inspections in production.
  config.active_record.attributes_for_inspect = [ :id ]

  # Enable DNS rebinding protection and other `Host` header attacks. DOMAIN
  # is the same variable docker-compose.go-rails-react.tls.yml already
  # requires for the Traefik Host() rule and the ACME certificate — one
  # source of truth for the deployment's real hostname. Left unset means
  # "allow any Host," same posture as this app already has in development
  # and test, since a value only ever needs to be added here, not guessed at.
  config.hosts << ENV["DOMAIN"] if ENV["DOMAIN"].present?
  # The Go data plane calls this service as http://rails:3000 (its Docker
  # Compose service name, not the public domain) for its internal API
  # polling and session lookups — same reason development.rb already
  # allows this host, just needed again here since config.hosts only
  # otherwise carries the public-facing DOMAIN in production.
  config.hosts << "rails"

  # Self-registration confirmation emails (UserMailer) — real SMTP if
  # SMTP_ADDRESS is set, otherwise Rails' :test delivery method. Left
  # unset behaves the same as dev/test: email confirmation is a new
  # opt-in capability, not something every existing install must wire up
  # immediately just to upgrade.
  if ENV["SMTP_ADDRESS"].present?
    config.action_mailer.delivery_method = :smtp
    config.action_mailer.smtp_settings = {
      address: ENV["SMTP_ADDRESS"], port: ENV.fetch("SMTP_PORT", 587).to_i,
      domain: ENV["SMTP_DOMAIN"].presence, enable_starttls_auto: true,
      # See development.rb's identical block for why authentication: is
      # conditional rather than always :plain.
      **(ENV["SMTP_USERNAME"].present? ? { user_name: ENV["SMTP_USERNAME"], password: ENV["SMTP_PASSWORD"].presence, authentication: :plain } : {}),
    }
  else
    config.action_mailer.delivery_method = :test
  end
  config.action_mailer.perform_deliveries = true
  config.action_mailer.raise_delivery_errors = false
end
