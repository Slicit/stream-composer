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
	if stream.Visibility == "public" {
		return true
	}
	if user == nil {
		return false
	}
	if user.Role == "admin" {
		return true
	}
	if stream.OwnerID != "" && stream.OwnerID == user.ID {
		return true
	}
	for _, id := range stream.SharedWith {
		if id == user.ID {
			return true
		}
	}
	return false
}
