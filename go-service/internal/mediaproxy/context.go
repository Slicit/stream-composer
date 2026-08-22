package mediaproxy

import (
	"context"

	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

type userCtxKey struct{}

// WithUser attaches the caller's resolved identity (nil for anonymous) to a
// request context. The guard middleware in front of the mounts is
// responsible for resolving the session — today nothing does yet (no
// control plane exists to ask), so every caller is anonymous until the
// Rails integration lands; ResolvePlayback already treats that correctly
// (public streams and, when the setting allows it, the programme).
func WithUser(ctx context.Context, user *streamstore.User) context.Context {
	return context.WithValue(ctx, userCtxKey{}, user)
}

// UserFromContext returns the caller's resolved identity, or nil when
// anonymous or when no guard ran at all.
func UserFromContext(ctx context.Context) *streamstore.User {
	u, _ := ctx.Value(userCtxKey{}).(*streamstore.User)
	return u
}
