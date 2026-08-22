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

    namespace :admin do
      resources :users, only: %i[index create update destroy]

      scope path: "streams", controller: "streams" do
        get "", action: :index
        post "", action: :create
        patch ":id", action: :update
        delete ":id", action: :destroy
        post ":id/rotate-key", action: :rotate_key
      end
    end
  end
end
