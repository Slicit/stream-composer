// Package access is the one place that decides whether a given user may
// reach a given stream — a direct port of server/src/access.js's
// canAccess(resource, user), kept identical on purpose so the two services
// can be diffed against each other during the migration.
package access

import "github.com/Slicit/stream-composer/go-service/internal/streamstore"

// CanAccess reports whether user may reach stream. A nil user means
// anonymous. Public streams are open to anyone; a private stream needs the
// owner, an admin, or an explicit grant in SharedWith.
func CanAccess(stream *streamstore.Stream, user *streamstore.User) bool {
	if stream == nil {
		return false
	}
	return canAccess(stream.Visibility, stream.OwnerID, stream.SharedWith, user)
}

// CanAccessChannel is CanAccess's identical twin for a Channel — same
// visibility/owner/sharedWith rule, kept as its own function (rather than
// a shared interface both types implement) since that is exactly how
// Rails' own Accessible concern and Node's access.js already express it:
// one small rule, applied to two resource types.
func CanAccessChannel(channel *streamstore.Channel, user *streamstore.User) bool {
	if channel == nil {
		return false
	}
	return canAccess(channel.Visibility, channel.OwnerID, channel.SharedWith, user)
}

func canAccess(visibility, ownerID string, sharedWith []string, user *streamstore.User) bool {
	if visibility == "public" {
		return true
	}
	if user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	if ownerID != "" && ownerID == user.ID {
		return true
	}
	for _, id := range sharedWith {
		if id == user.ID {
			return true
		}
	}
	return false
}
