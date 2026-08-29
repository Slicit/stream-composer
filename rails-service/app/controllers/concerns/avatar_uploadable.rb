# Shared by Api::AuthController#avatar (self-service) and
# Api::Admin::UsersController#avatar (an admin acting on someone else's
# account) — same extension whitelist, size cap, and file-write logic
# either way, just a different target user.
module AvatarUploadable
  extend ActiveSupport::Concern

  MAX_AVATAR_BYTES = 5 * 1024 * 1024
  AVATAR_IMAGE_EXTENSIONS = { "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp" }.freeze

  private

  def store_avatar!(user)
    ext = AVATAR_IMAGE_EXTENSIONS[request.content_type]
    return render_error(:bad_request, "Avatars must be PNG, JPEG or WebP.") unless ext

    body = request.body.read
    return render_error(:bad_request, "The uploaded file was empty.") if body.blank?
    return render_error(:bad_request, "Avatars must be 5MB or smaller.") if body.bytesize > MAX_AVATAR_BYTES

    dir = Rails.public_path.join("uploads", "avatars")
    FileUtils.mkdir_p(dir)
    user.remove_avatar_file
    filename = "#{user.id}.#{ext}"
    File.binwrite(dir.join(filename), body)

    user.update!(avatar: "/uploads/avatars/#{filename}")
    render json: { user: user.as_public_json }
  end
end
