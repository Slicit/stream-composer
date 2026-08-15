--[[
  Stream Composer — OBS Studio helper
  ==================================

  Configures OBS to publish to a Stream Composer server without digging through
  Settings → Stream. Paste the two values from the admin console (or the whole
  ingest URL) and press "Apply to OBS".

  Install
  -------
    1. Save this file somewhere permanent.
    2. In OBS: Tools → Scripts → "+" → pick this file.
    3. Fill in the server URL and stream key, then press "Apply to OBS".

  It only touches the streaming *service* (server + key). Your encoder,
  resolution and bitrate settings are left exactly as they are — see the
  recommendations printed in the script log.
--]]

local obs = obslua

local server = ""
local key = ""
local auto_start = false
local applied_once = false

-- ---------------------------------------------------------------- helpers

local function log(fmt, ...)
  obs.script_log(obs.LOG_INFO, string.format(fmt, ...))
end

local function warn(fmt, ...)
  obs.script_log(obs.LOG_WARNING, string.format(fmt, ...))
end

--- Accepts either a bare server URL or a full "rtmp://host/live/KEY" and
--- returns the server part plus the key it found (if any).
local function split_ingest_url(url)
  url = (url or ""):gsub("%s+", "")
  if url == "" then return "", nil end

  local scheme, rest = url:match("^(%a[%w%+%-%.]*://)(.*)$")
  if not scheme then return url, nil end

  local segments = {}
  for segment in rest:gmatch("[^/]+") do
    segments[#segments + 1] = segment
  end

  -- host + application (e.g. host/live) is the server; anything after that is
  -- the stream key.
  if #segments >= 3 then
    local found_key = segments[#segments]
    local server_part = scheme .. table.concat(segments, "/", 1, #segments - 1)
    return server_part, found_key
  end
  return url, nil
end

local function trim_trailing_slash(s)
  return (s or ""):gsub("/+$", "")
end

-- ------------------------------------------------------------------ actions

local function apply_settings()
  local target_server, embedded_key = split_ingest_url(server)
  local target_key = key
  if (target_key == nil or target_key == "") and embedded_key then
    target_key = embedded_key
    log("Took the stream key from the URL you pasted.")
  end

  target_server = trim_trailing_slash(target_server)

  if target_server == "" then
    warn("No server URL — copy it from the admin console (Streams → OBS).")
    return false
  end
  if target_key == nil or target_key == "" then
    warn("No stream key — copy it from the admin console (Streams → OBS).")
    return false
  end

  local settings = obs.obs_data_create()
  obs.obs_data_set_string(settings, "server", target_server)
  obs.obs_data_set_string(settings, "key", target_key)
  obs.obs_data_set_bool(settings, "use_auth", false)

  local service = obs.obs_service_create("rtmp_custom", "stream_composer_service", settings, nil)
  if service == nil then
    warn("OBS refused to create the streaming service.")
    obs.obs_data_release(settings)
    return false
  end

  obs.obs_frontend_set_streaming_service(service)
  obs.obs_frontend_save_streaming_service()
  obs.obs_service_release(service)
  obs.obs_data_release(settings)

  applied_once = true
  log("OBS is now pointed at %s (key ending %s).", target_server, target_key:sub(-4))
  log("Recommended output for a 720p source: 1280x720, 30 fps, 2500-4000 kb/s,")
  log("keyframe interval 2 s, x264 preset veryfast, profile high, tune zerolatency.")
  return false
end

local function start_streaming()
  if not applied_once then apply_settings() end
  if obs.obs_frontend_streaming_active() then
    log("Already streaming.")
    return false
  end
  obs.obs_frontend_streaming_start()
  log("Streaming started.")
  return false
end

local function stop_streaming()
  if obs.obs_frontend_streaming_active() then
    obs.obs_frontend_streaming_stop()
    log("Streaming stopped.")
  end
  return false
end

-- ------------------------------------------------------------- OBS plumbing

function script_description()
  return [[<h3>Stream Composer</h3>
<p>Points OBS at a Stream Composer server in two fields. Copy them from the
admin console under <b>Streams &rarr; OBS</b>.</p>
<p>You can paste either the server URL on its own, or the whole
<code>rtmp://host/live/your-key</code> — the key is picked out automatically.</p>]]
end

function script_properties()
  local props = obs.obs_properties_create()

  obs.obs_properties_add_text(props, "server", "Server URL", obs.OBS_TEXT_DEFAULT)
  obs.obs_properties_add_text(props, "key", "Stream key", obs.OBS_TEXT_PASSWORD)
  obs.obs_properties_add_bool(props, "auto_start", "Start streaming as soon as OBS opens")

  obs.obs_properties_add_button(props, "apply", "Apply to OBS", apply_settings)
  obs.obs_properties_add_button(props, "start", "Start streaming now", start_streaming)
  obs.obs_properties_add_button(props, "stop", "Stop streaming", stop_streaming)

  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "server", "rtmp://your-server/live")
  obs.obs_data_set_default_bool(settings, "auto_start", false)
end

function script_update(settings)
  server = obs.obs_data_get_string(settings, "server")
  key = obs.obs_data_get_string(settings, "key")
  auto_start = obs.obs_data_get_bool(settings, "auto_start")
end

local function on_event(event)
  if event == obs.OBS_FRONTEND_EVENT_FINISHED_LOADING and auto_start then
    apply_settings()
    -- Give OBS a moment to settle before opening the connection.
    obs.timer_add(function()
      obs.remove_current_callback()
      start_streaming()
    end, 2000)
  elseif event == obs.OBS_FRONTEND_EVENT_STREAMING_STARTED then
    log("Publishing to Stream Composer.")
  elseif event == obs.OBS_FRONTEND_EVENT_STREAMING_STOPPED then
    log("Publishing stopped.")
  end
end

function script_load(settings)
  obs.obs_frontend_add_event_callback(on_event)
end

function script_unload()
  obs.obs_frontend_remove_event_callback(on_event)
end
