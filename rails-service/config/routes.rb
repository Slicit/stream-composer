Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :api do
    post "auth/login", to: "auth#login"
    delete "auth/logout", to: "auth#logout"
    get "auth/me", to: "auth#me"

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

    namespace :admin do
      resources :users, only: %i[index create update destroy]

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
    end
  end
end
