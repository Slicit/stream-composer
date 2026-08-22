module Internal
  # The Go data plane's view of every stream and restream destination —
  # polled, not looked up per-request (see
  # go-service/internal/streamstore.RailsBridge), so a media auth decision
  # or a relay-runner tick never waits on an HTTP round trip to this
  # service. Mirrors server/src/routes/hooks.js's own convention: the
  # shared secret travels in the URL, since this is the one channel
  # guaranteed to never reach a browser. Relay keys travel in full here
  # (never masked) for the same reason streams.js's own internal callers
  # always saw the real ingest key — this is server-to-server, behind the
  # shared secret, not a response a browser ever sees.
  class StreamsController < ActionController::API
    include InternalTokenAuthenticatable

    def index
      setting = AppSetting.instance
      render json: {
        streams: Stream.all.map do |s|
          { id: s.id, key: s.key, playbackId: s.playback_id, enabled: s.enabled,
            visibility: s.visibility, ownerId: s.owner_id, sharedWith: s.shared_with,
            name: s.name, nickname: s.nickname }
        end,
        relays: RelayDestination.all.map do |r|
          { id: r.id, streamId: r.stream_id, provider: r.provider, name: r.name,
            url: r.url, key: r.key, audio: r.audio, enabled: r.enabled }
        end,
        # Channels' own configuration only (name/slug/membership/access) —
        # viewing a channel's live state is entirely the Go data plane's
        # concern (layout, live status), same split as streams above.
        channels: Channel.all.map do |c|
          { id: c.id, name: c.name, slug: c.slug, visibility: c.visibility,
            ownerId: c.owner_id, sharedWith: c.shared_with, streamIds: c.stream_ids,
            backgroundImage: c.background_image.presence }
        end,
        settings: {
          publicViewing: setting.public_viewing,
          # Resolved to a slug here rather than handing the Go side a bare
          # id: it already has to look the channel up by slug for every
          # other channel request, so this way there is exactly one way to
          # address a channel across the whole data plane, not two.
          homepageChannelSlug: setting.homepage_channel&.slug,
        },
      }
    end
  end
end
