# The one place access is decided for a resource with visibility/owner/
# sharing — a direct port of server/src/access.js's canAccess(resource,
# user), kept identical on purpose across the Node, Go and Rails
# implementations so the three can be diffed against each other during the
# migration. Included by Stream (and, once it exists, Channel).
module Accessible
  extend ActiveSupport::Concern

  # user may be nil (anonymous).
  def accessible_to?(user)
    return true if visibility == "public"
    return false if user.nil?
    return true if user.role == "admin"
    return true if respond_to?(:owner_id) && owner_id.present? && owner_id == user.id
    Array(shared_with).include?(user.id)
  end
end
