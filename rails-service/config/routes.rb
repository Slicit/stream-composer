Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  # The Go data plane's read-only view of stream data. Outside /api on
  # purpose, same as the Node backend's /internal/*: the shared secret in
  # the URL is this endpoint's only gate, not a session.
  get "internal/:token/streams", to: "internal/streams#index"

  # Lets the Go data plane resolve a viewer's sc_session cookie (sent as
  # its digest, never the raw token — see Internal::SessionsController)
  # without holding its own copy of the sessions table.
  get "internal/:token/sessions/:digest", to: "internal/sessions#show"

  namespace :api do
    post "register", to: "registrations#create"
    post "confirm-email", to: "email_confirmations#create"
    post "confirm-email/resend", to: "email_confirmations#resend"

    post "auth/login", to: "auth#login"
    post "auth/login/verify-2fa", to: "auth#verify_two_factor"
    delete "auth/logout", to: "auth#logout"
    get "auth/me", to: "auth#me"
    patch "auth/me", to: "auth#update_me"
    delete "auth/impersonate", to: "auth#stop_impersonating"
    put "auth/me/avatar", to: "auth#avatar"

    post "two-factor/setup", to: "two_factor#setup"
    post "two-factor/enable", to: "two_factor#enable"
    post "two-factor/disable", to: "two_factor#disable"

    scope path: "streams/mine", controller: "streams" do
      get "", action: :index
      post "", action: :create
      patch ":id", action: :update
      delete ":id", action: :destroy
      post ":id/rotate-key", action: :rotate_key
    end

    scope path: "relays/mine", controller: "relays" do
      get "", action: :index
      post "", action: :create
      patch ":id", action: :update
      delete ":id", action: :destroy
      get ":id/key", action: :key
    end

    get "streams/available", to: "streams_available#index"
    get "games", to: "games#index"

    # Every channel the signed-in user can view (public, owned, or
    # explicitly shared) — the left nav's "Channels" list. Distinct from
    # channels/mine below, which is owned-only self-service CRUD.
    get "channels", to: "channels#accessible"

    scope path: "channels/mine", controller: "channels" do
      get "", action: :index
      post "", action: :create
      get ":id", action: :show
      patch ":id", action: :update
      delete ":id", action: :destroy
      put ":id/background", action: :background
    end

    scope path: "channels/mine/:channel_id/compositions", controller: "channel_compositions" do
      get "", action: :index
      patch ":orientation", action: :update
      post ":orientation/destinations", action: :create_destination
      patch ":orientation/destinations/:id", action: :update_destination
      delete ":orientation/destinations/:id", action: :destroy_destination
    end

    namespace :admin do
      resources :users, only: %i[index show create update destroy] do
        post "impersonate", on: :member
        post "reset-2fa", on: :member, action: :reset_two_factor
        put "avatar", on: :member
      end

      get "stats/status", to: "stats#status"
      get "stats/bandwidth-history", to: "stats#bandwidth_history"

      get "settings", to: "settings#show"
      patch "settings", to: "settings#update"

      scope path: "streams", controller: "streams" do
        get "", action: :index
        post "", action: :create
        patch ":id", action: :update
        delete ":id", action: :destroy
        post ":id/rotate-key", action: :rotate_key
      end

      scope path: "relays", controller: "relays" do
        get "", action: :index
        post "", action: :create
        patch ":id", action: :update
        delete ":id", action: :destroy
      end

      scope path: "channels", controller: "channels" do
        get "", action: :index
        post "", action: :create
        get ":id", action: :show
        patch ":id", action: :update
        delete ":id", action: :destroy
        put ":id/homepage", action: :set_homepage
        delete ":id/homepage", action: :clear_homepage
        put ":id/background", action: :background
      end

      scope path: "channels/:channel_id/compositions", controller: "channel_compositions" do
        get "", action: :index
        patch ":orientation", action: :update
        post ":orientation/destinations", action: :create_destination
        patch ":orientation/destinations/:id", action: :update_destination
        delete ":orientation/destinations/:id", action: :destroy_destination
      end

      scope path: "games", controller: "games" do
        get "", action: :index
        post "", action: :create
        patch ":id", action: :update
        delete ":id", action: :destroy
      end
    end
  end

  # The React SPA shell — only reached in production (see PagesController's
  # own comment). Declared last so every /api, /internal and /up route above
  # still wins; ActionDispatch::Static already intercepts requests for a
  # real built asset (JS/CSS/images) before routing ever sees them, so this
  # only ever serves index.html, for React Router to take over client-side.
  root to: "pages#app"
  get "*path", to: "pages#app"
end
