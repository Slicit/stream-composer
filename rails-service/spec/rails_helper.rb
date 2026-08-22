# Unconditional, not ||=: the containerized dev stack bakes RAILS_ENV=
# development into the image (docker-compose.migration.yml, so the live
# service runs correctly) and that same env var leaks into every
# `docker exec ... bundle exec rspec` invocation. ||= would silently let
# the whole suite run under development instead of test — which still
# boots and mostly still works, except development.rb's `config.hosts <<
# "rails"` then blocks every request-spec's default www.example.com host
# with a 403, with no indication the environment was ever wrong. Specs
# must always run under test, full stop.
ENV["RAILS_ENV"] = "test"
require_relative "../config/environment"
abort("The Rails environment is running in production mode!") if Rails.env.production?
require "rspec/rails"

Dir[Rails.root.join("spec", "support", "**", "*.rb")].sort.each { |f| require f }

begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end

RSpec.configure do |config|
  config.fixture_paths = [Rails.root.join("spec/fixtures")]
  config.use_transactional_fixtures = true
  config.infer_spec_type_from_file_location!
  config.filter_rails_from_backtrace!
end
