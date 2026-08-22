# Production image: builds the React SPA and bundles it into Rails' own
# public/ directory, so the deployed stack is Rails (serving the SPA and
# the API) plus the Go data plane behind Traefik — no separate static-file
# container. See docker-compose.go-rails-react.yml.

# ---------------------------------------------------------------- react build
FROM node:20-slim AS react-build
WORKDIR /app
COPY react-app/package.json react-app/package-lock.json ./
RUN npm ci
COPY react-app/ .
RUN npm run build

# ------------------------------------------------------------------ gems
FROM ruby:3.3-slim AS build
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential libpq-dev git && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives

WORKDIR /rails
COPY rails-service/Gemfile rails-service/Gemfile.lock* ./
RUN bundle config set --local deployment true && \
    bundle config set --local without development:test && \
    bundle install --jobs 4

COPY rails-service/ .
# The React build's static assets — served by Rails' own ActionDispatch::
# Static, same origin as the API, no CORS/SameSite story needed in
# production either.
COPY --from=react-build /app/dist/ public/

RUN bundle exec bootsnap precompile app/ lib/ config/

# ------------------------------------------------------------------ runtime
FROM ruby:3.3-slim
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y libpq5 curl && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives && \
    useradd --create-home --shell /bin/false rails

WORKDIR /rails
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /rails /rails
RUN mkdir -p /rails/tmp/pids /rails/public/uploads && chown -R rails:rails /rails

ENV RAILS_ENV=production \
    RAILS_LOG_TO_STDOUT=1 \
    RAILS_SERVE_STATIC_FILES=1 \
    BUNDLE_WITHOUT=development:test \
    PORT=3000

USER rails
EXPOSE 3000
ENTRYPOINT ["sh", "-c", "bin/rails db:prepare && exec bin/rails server -b 0.0.0.0"]
