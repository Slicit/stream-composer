# Shared shape between RelayDestination (forwards one raw source) and
# ChannelRelayDestination (forwards a channel's composed output) — provider
# presets, URL/key validation and cleanup, and the destination-URL/masking
# helpers. Extracted from RelayDestination, which was here first; see that
# model for the fields this deliberately does not cover (audio mode, the
# per-server destination cap — both mean something different, or nothing
# at all, on the composed side).
module RelayDestinationLike
  extend ActiveSupport::Concern

  # Where the well-known platforms want their RTMP. `url` is only a
  # starting point — every one of these is editable afterwards, since
  # ingest hostnames are regional and do change.
  PROVIDERS = [
    {
      id: "twitch", label: "Twitch", url: "rtmp://live.twitch.tv/app",
      urlLabel: "Ingest server",
      urlHint: "The default hands you to Twitch's nearest point of presence. Swap in a specific server from the ingest list if you need to pin one.",
      keyLabel: "Primary stream key",
      keyHint: "Creator Dashboard -> Settings -> Stream -> Primary Stream key. It begins with live_.",
    },
    {
      id: "youtube", label: "YouTube Live", url: "rtmp://a.rtmp.youtube.com/live2",
      urlLabel: "Ingest server",
      urlHint: "a.rtmp.youtube.com is the primary ingest. Use rtmps://a.rtmps.youtube.com/live2 if outbound 1935 is blocked - that one runs on 443.",
      keyLabel: "Stream key",
      keyHint: "YouTube Studio -> Go live -> Stream settings -> Stream key. It looks like abcd-efgh-ijkl-mnop-qrst.",
    },
    {
      id: "youtube-backup", label: "YouTube Live (backup ingest)", url: "rtmp://b.rtmp.youtube.com/live2?backup=1",
      urlLabel: "Ingest server",
      urlHint: "YouTube's redundant ingest. Add it alongside the primary, with the same key, and YouTube keeps the broadcast up if one path drops.",
      keyLabel: "Stream key",
      keyHint: "The same key as the primary ingest.",
    },
    {
      id: "tiktok", label: "TikTok LIVE", url: "",
      urlLabel: "Server URL",
      urlHint: "TikTok LIVE Studio issues a session-specific ingest URL each time you go live — unlike Twitch/YouTube there is no fixed public server, so paste the RTMP URL it shows you.",
      keyLabel: "Stream key",
      keyHint: "Shown by TikTok LIVE Studio alongside the server URL. Both are regenerated every session — you will need to update this destination each time you go live.",
    },
    {
      id: "custom", label: "Custom RTMP", url: "",
      urlLabel: "Server URL",
      urlHint: "Anything that speaks RTMP: Facebook, Kick, Restream.io, another Stream Composer, your own MediaMTX. rtmp:// or rtmps://.",
      keyLabel: "Stream key",
      keyHint: "Appended to the server URL as the final path segment. Leave it empty if the whole address is in the URL above.",
    },
  ].freeze

  included do
    const_set(:PROVIDERS, PROVIDERS) unless const_defined?(:PROVIDERS, false)

    before_validation :apply_provider_default_url, on: :create
    before_validation { self.provider = "custom" if provider.blank? || self.class.provider_by_id(provider).nil? }
    before_validation :clean_name
    before_validation :clean_url
    before_validation :clean_key

    validates :url, presence: { message: "Give the destination a server URL." }, length: { maximum: 400, message: "That server URL is too long." }
    validate :url_is_a_valid_rtmp_url
    validates :key, length: { maximum: 256, message: "That stream key is too long." }
    validate :key_has_no_unusual_characters
  end

  class_methods do
    def provider_by_id(id)
      self::PROVIDERS.find { |p| p[:id] == id }
    end

    # The URL a platform expects: the key as the final path segment, kept
    # *after* the query string — YouTube's backup ingest is
    # ".../live2?backup=1", and appending the key after that would send the
    # literal key "1" instead.
    def destination_url(url, key)
      raw = url.to_s.strip
      k = key.to_s.strip
      return raw if k.blank?
      q = raw.index("?")
      base = (q ? raw[0...q] : raw).sub(%r{/+\z}, "")
      query = q ? raw[q..] : ""
      "#{base}/#{k}#{query}"
    end

    # What the operator may safely be shown, and what may safely be logged.
    # A third-party stream key is a publishing credential for somebody
    # else's channel, so it goes nowhere near a log line or a status
    # payload in full.
    def mask_key(key)
      value = key.to_s
      return "" if value.empty?
      return "•" * value.length if value.length <= 8
      "#{value[0, 3]}#{'•' * 6}#{value[-3, 3]}"
    end
  end

  def destination_url
    self.class.destination_url(url, key)
  end

  def key_masked
    self.class.mask_key(key)
  end

  private

  def apply_provider_default_url
    return if url.present?
    provider_def = self.class.provider_by_id(provider) || self.class.provider_by_id("custom")
    self.url = provider_def[:url]
  end

  def clean_name
    fallback = begin
      provider_def = self.class.provider_by_id(provider)
      if provider == "custom" && url.present?
        URI.parse(url).host || (provider_def && provider_def[:label]) || "destination"
      else
        (provider_def && provider_def[:label]) || "destination"
      end
    rescue URI::InvalidURIError
      (self.class.provider_by_id(provider) || {})[:label] || "destination"
    end
    cleaned = name.to_s.gsub(/[\r\n\t]+/, " ").strip
    self.name = cleaned.presence || fallback
  end

  def clean_url
    self.url = url.to_s.strip
  end

  def clean_key
    self.key = key.to_s.strip
  end

  # Rejects whitespace and control characters using POSIX bracket classes
  # ([:space:], [:cntrl:]) rather than \x00-\x1f style escapes — those
  # looked identical to plain text in every editor but silently became
  # literal NUL/0x1f/0x7f bytes when this file was first written, breaking
  # the regex outright. POSIX classes sidestep the whole class of mistake.
  def url_is_a_valid_rtmp_url
    return if url.blank? # presence validation already reports this
    if url.match?(/[[:space:][:cntrl:]]/)
      errors.add(:url, "cannot contain spaces or control characters")
      return
    end
    uri = begin
      URI.parse(url)
    rescue URI::InvalidURIError
      nil
    end
    unless uri && %w[rtmp rtmps].include?(uri.scheme)
      errors.add(:url, "must be an rtmp:// or rtmps:// URL")
      return
    end
    errors.add(:url, "has no host") if uri.host.blank?
  end

  def key_has_no_unusual_characters
    return if key.blank?
    errors.add(:key, "cannot contain spaces or unusual characters") unless key.match?(/\A[!-~]+\z/)
  end
end
