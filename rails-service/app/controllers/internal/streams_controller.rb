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
        channels: Channel.includes(:featured_game).all.map do |c|
          { id: c.id, name: c.name, slug: c.slug, visibility: c.visibility,
            ownerId: c.owner_id, sharedWith: c.shared_with, streamIds: c.stream_ids,
            backgroundImage: c.background_image.presence, description: c.description,
            currentTopic: c.current_topic, featuredGame: c.featured_game&.name,
            layoutMode: c.layout_mode }
        end,
        # The compositor's own config — see go-service/internal/
        # compositionscheduler, which turns "enabled + a live member" into
        # start/stop calls against the compositor service (a relay
        # destination is not required for a job to run — see that
        # package's own comment for why). destinations travel as a flat,
        # separate list (channelRelays) rather than nested under each
        # composition: internal/streamstore.Relay unifies both a stream's
        # and a composition's destinations into one shape relayrunner
        # iterates. previewToken authorizes go-service/internal/
        # mediaproxy's composed-preview HLS mount — travels here in full
        # for the same reason relay keys do (see this controller's own
        # top comment): server-to-server, behind the shared secret.
        channelCompositions: ChannelComposition.all.map do |cc|
          { id: cc.id, channelId: cc.channel_id, orientation: cc.orientation, enabled: cc.enabled,
            width: cc.width, height: cc.height, fps: cc.fps, bitrateKbps: cc.bitrate_kbps,
            preset: cc.preset, encoder: cc.encoder, background: cc.background_color,
            labels: cc.labels, labelSize: cc.label_size, previewToken: cc.preview_token }
        end,
        channelRelays: ChannelRelayDestination.all.map do |d|
          { id: d.id, channelCompositionId: d.channel_composition_id, provider: d.provider,
            name: d.name, url: d.url, key: d.key, enabled: d.enabled }
        end,
        settings: {
          publicViewing: setting.public_viewing,
          # Resolved to a slug here rather than handing the Go side a bare
          # id: it already has to look the channel up by slug for every
          # other channel request, so this way there is exactly one way to
          # address a channel across the whole data plane, not two.
          homepageChannelSlug: setting.homepage_channel&.slug,
          defaultLayoutMode: setting.default_layout_mode,
        },
      }
    end
  end
end
