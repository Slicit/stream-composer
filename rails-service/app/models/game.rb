# A game a channel can flag as its featured_game — name only for now (see
# db/seeds.rb for the starting list). Deliberately its own table rather
# than a free-text field on Channel: a dropdown means every channel that
# says "Valorant" says it the same way, which is what makes this worth
# querying/filtering on later. Box art, IGDB ids and the like are a later
# problem; this exists to unblock the picker, not to be a game catalog.
class Game < ApplicationRecord
  has_many :channels, foreign_key: :featured_game_id, inverse_of: :featured_game, dependent: nil

  before_validation { self.name = name.to_s.strip }

  validates :name, presence: true, length: { maximum: 100 }
  validates :name, uniqueness: { case_sensitive: false, message: "is already in the list" }

  def as_public_json
    { id: id, name: name }
  end
end
