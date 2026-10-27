/**
	Just create the global mario object.
	Code by Rob Kleffner, 2011
*/

var Mario = {};

/**
	Points awarded for each action (used by the score / leaderboard).
*/
Mario.Points = {
    Coin: 200,          // coin collected (block or level)
    Stomp: 100,         // enemy stomped
    ShotKill: 200,      // enemy killed with a shell or a fireball
    PowerUp: 1000,      // mushroom or fire flower
    LevelClear: 1000,   // level exit reached
    TimeBonus: 50       // per second left on the clock at the exit
};

/**
	Formats a score with leading zeros, like the original HUD ("00012300").
*/
Mario.FormatScore = function(score) {
    var s = "" + (score | 0);
    while (s.length < 8) {
        s = "0" + s;
    }
    return s;
};

/**
	Bridge to the optional leaderboard UI (scores.js). The game keeps working
	if the leaderboard script is not loaded or the API is unreachable.
*/
Mario.GameFinished = function(outcome) {
    var c = Mario.MarioCharacter;
    if (window.Leaderboard && typeof window.Leaderboard.onGameFinished === "function") {
        window.Leaderboard.onGameFinished({
            score: c.Score,
            world: outcome === "win" ? 8 : Mario.GlobalMapState.WorldNumber + 1,
            levels: c.LevelsCleared,
            coins: c.TotalCoins,
            kills: c.Kills,
            outcome: outcome
        });
    }
};

Mario.IsInputCaptured = function() {
    return !!(window.Leaderboard && typeof window.Leaderboard.isOpen === "function" && window.Leaderboard.isOpen());
};