# Serves the React SPA's shell for every route the client side owns
# (React Router) — index.html, then the browser takes over. Only reached
# in production, where the SPA build lives in public/ (see Dockerfile);
# in development the Vite dev server serves the shell directly and this
# controller is never hit.
class PagesController < ActionController::API
  def app
    send_file Rails.public_path.join("index.html"), type: "text/html", disposition: "inline"
  end
end
