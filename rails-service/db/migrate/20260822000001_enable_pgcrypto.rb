class EnablePgcrypto < ActiveRecord::Migration[8.1]
  def change
    # gen_random_uuid() is built into Postgres 13+ core, but enabling
    # pgcrypto here too costs nothing and keeps this working on older
    # Postgres if this ever has to run against one.
    enable_extension "pgcrypto" unless extension_enabled?("pgcrypto")
  end
end
