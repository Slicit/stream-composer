'use strict';

/**
 * Rules for "can this user see this thing" and "can this user manage this
 * thing", shared by streams, channels and (for streams specifically)
 * restream destinations.
 *
 * Access is embedded directly on the resource (`visibility`, `sharedWith`,
 * `ownerId`) rather than kept in a separate grants collection, the same way
 * relays.js embeds `streamId` rather than using a join table.
 */

function canAccess(resource, user) {
  if (!resource) return false;
  if (resource.visibility === 'public') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (resource.ownerId && resource.ownerId === user.id) return true;
  return Array.isArray(resource.sharedWith) && resource.sharedWith.includes(user.id);
}

/**
 * Ownership authority (create/edit/delete), as opposed to canAccess's
 * viewing authority — a resource's own visibility/sharedWith never grants
 * the right to manage it, only its owner or an admin does. 404 rather than
 * 403 when the resource itself is missing: routes/channels.js and
 * routes/streamer.js both want "no such thing" indistinguishable from "not
 * yours", the same "don't confirm existence" posture applied elsewhere.
 */
function requireOwner(resource, user) {
  if (!resource) throw Object.assign(new Error('No such thing.'), { status: 404 });
  if (resource.ownerId !== user.id && user.role !== 'admin') {
    throw Object.assign(new Error('You do not own this.'), { status: 403 });
  }
  return resource;
}

module.exports = { canAccess, requireOwner };
