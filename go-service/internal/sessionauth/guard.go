package sessionauth

import (
	"log/slog"
	"net/http"

	"github.com/Slicit/stream-composer/go-service/internal/mediaproxy"
)

// Guard resolves the caller's sc_session cookie (if any) and attaches the
// result to the request context via mediaproxy.WithUser before calling
// next — never blocks a request itself; ResolvePlayback is what turns
// "no user" or "wrong user" into a denial for anything that isn't public.
// A resolution failure (Rails unreachable) degrades to anonymous rather
// than failing the request, logged at Warn since it silently narrows
// access rather than granting it.
func Guard(resolver *Resolver, log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(CookieName)
		if err != nil || cookie.Value == "" {
			next.ServeHTTP(w, r)
			return
		}

		user, err := resolver.Resolve(r.Context(), cookie.Value)
		if err != nil {
			log.Warn("session lookup failed; treating the caller as anonymous", "error", err.Error())
			next.ServeHTTP(w, r)
			return
		}

		next.ServeHTTP(w, r.WithContext(mediaproxy.WithUser(r.Context(), user)))
	})
}
