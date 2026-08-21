'use strict';

/**
 * One rule for "can this user see this thing", shared by streams and
 * channels (proxy.js's stream-playback resolution and channels.js's
 * channel-visibility gate both call this).
 *
 * Access is embedded directly on the resource (`visibility`, `sharedWith`,
 * and — channels only — `ownerId`) rather than kept in a separate grants
 * collection, the same way relays.js embeds `streamId` rather than using a
 * join table. A stream has no `ownerId`; that branch is simply never hit
 * for one, so this stays a single function for both resource kinds.
 */

function canAccess(resource, user) {
  if (!resource) return false;
  if (resource.visibility === 'public') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (resource.ownerId && resource.ownerId === user.id) return true;
  return Array.isArray(resource.sharedWith) && resource.sharedWith.includes(user.id);
}

module.exports = { canAccess };
