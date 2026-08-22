# This file runs as part of `bin/rails db:prepare` on a freshly created
# database, and any time `bin/rails db:seed` is run directly.
User.ensure_bootstrap_admin!
