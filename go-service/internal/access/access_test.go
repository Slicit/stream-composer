package access

import (
	"testing"

	"github.com/Slicit/stream-composer/go-service/internal/streamstore"
)

// Mirrors server/test/api.test.js's "access.canAccess: public, owner, admin,
// granted and a stranger" truth table, so the two implementations can be
// checked against each other by eye.
func TestCanAccess(t *testing.T) {
	isPublic := &streamstore.Stream{Visibility: "public"}
	isPrivate := &streamstore.Stream{Visibility: "private", OwnerID: "owner-1", SharedWith: []string{"granted-1"}}

	cases := []struct {
		name   string
		stream *streamstore.Stream
		user   *streamstore.User
		want   bool
	}{
		{"public is open even to anonymous", isPublic, nil, true},
		{"private refuses anonymous", isPrivate, nil, false},
		{"private refuses a stranger", isPrivate, &streamstore.User{ID: "stranger", Role: "viewer"}, false},
		{"owner", isPrivate, &streamstore.User{ID: "owner-1", Role: "viewer"}, true},
		{"explicitly shared", isPrivate, &streamstore.User{ID: "granted-1", Role: "viewer"}, true},
		{"admin overrides everything", isPrivate, &streamstore.User{ID: "anyone", Role: "admin"}, true},
		{"a missing resource is never accessible", nil, &streamstore.User{ID: "x", Role: "admin"}, false},
		{
			"a stream with no owner must simply never match that branch, not panic",
			&streamstore.Stream{Visibility: "private"},
			&streamstore.User{ID: "x", Role: "viewer"},
			false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := CanAccess(c.stream, c.user)
			if got != c.want {
				t.Errorf("CanAccess() = %v, want %v", got, c.want)
			}
		})
	}
}
