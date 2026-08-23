# This file runs as part of `bin/rails db:prepare` on a freshly created
# database, and any time `bin/rails db:seed` is run directly.
User.ensure_bootstrap_admin!

# A starting list for the featured-game picker — name only, no external
# catalog/API integration (no credentials for one, and "top 100 for now,
# we'll consolidate later" doesn't ask for one). Safe to re-run: each name
# is only created if missing, so an operator's own additions are never
# touched.
TOP_GAMES = [
  "League of Legends", "Counter-Strike 2", "Valorant", "Fortnite", "Minecraft",
  "Grand Theft Auto V", "Dota 2", "Apex Legends", "World of Warcraft", "Overwatch 2",
  "Call of Duty: Warzone", "Call of Duty: Modern Warfare III", "Rocket League", "Rainbow Six Siege",
  "PUBG: Battlegrounds", "Just Chatting", "EA Sports FC 24", "NBA 2K24", "Madden NFL 24",
  "Teamfight Tactics", "Hearthstone", "Magic: The Gathering Arena", "Path of Exile",
  "Path of Exile 2", "Diablo IV", "Destiny 2", "Halo Infinite", "Star Wars: Battlefront II",
  "Elden Ring", "Dark Souls III", "Sekiro: Shadows Die Twice", "The Elder Scrolls V: Skyrim",
  "Baldur's Gate 3", "Divinity: Original Sin 2", "The Witcher 3: Wild Hunt", "Cyberpunk 2077",
  "Red Dead Redemption 2", "God of War Ragnarök", "Horizon Forbidden West", "Marvel Rivals",
  "Genshin Impact", "Honkai: Star Rail", "Zenless Zone Zero", "Wuthering Waves",
  "Street Fighter 6", "Tekken 8", "Mortal Kombat 1", "Guilty Gear Strive",
  "Super Smash Bros. Ultimate", "Splatoon 3", "The Legend of Zelda: Tears of the Kingdom",
  "Super Mario Bros. Wonder", "Animal Crossing: New Horizons", "Pokémon Scarlet/Violet",
  "Stardew Valley", "Terraria", "Palworld", "Sea of Thieves", "No Man's Sky",
  "Sid Meier's Civilization VI", "Age of Empires IV", "StarCraft II", "Total War: Warhammer III",
  "Among Us", "Fall Guys", "Lethal Company", "Content Warning", "Phasmophobia",
  "Dead by Daylight", "Escape from Tarkov", "Rust", "ARK: Survival Ascended", "DayZ",
  "Helldivers 2", "Warframe", "Deep Rock Galactic", "Monster Hunter Wilds",
  "Monster Hunter World", "Final Fantasy XIV Online", "Final Fantasy VII Rebirth",
  "Persona 5 Royal", "Octopath Traveler II", "Slay the Spire", "Balatro", "Vampire Survivors",
  "Hades II", "Celeste", "Hollow Knight", "It Takes Two", "Portal 2",
  "Half-Life: Alyx", "Beat Saber", "Chess.com", "Poker", "Geometry Dash",
  "Trackmania", "iRacing", "F1 24", "Forza Horizon 5", "Farming Simulator 25",
  "American Truck Simulator", "Microsoft Flight Simulator", "Cities: Skylines II",
  "Music", "Art", "IRL",
].freeze

TOP_GAMES.each { |name| Game.find_or_create_by!(name: name) }
