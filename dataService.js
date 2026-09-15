const D = window.__STATIC_DATA__;
const _cache = {};
async function fetchJSON(url) {
    if (_cache[url]) return _cache[url];
    const r = await fetch(url);
    const j = await r.json();
    _cache[url] = j;
    return j;
}
export const api = {
    async getDraft(year)       { return D.draft[year] || []; },
    async getRosters(year)     { return D.rosters || []; },
    async getUsers(year)       { return D.users || []; },
    async getLeagueUsers()     { return D.league_users || []; },
    async getTransactions()    { return D.transactions || []; },
    async getStandings()       { return D.standings || []; },
    async getHeadToHead()      { return D.head_to_head || []; },
    async getPlayerStats(year) { return fetchJSON(`data/${year}/player_season_stats.json`); },
    async getMatchups(year)    { return fetchJSON(`data/${year}/matchups.json`); },
    async getSeasonHistory()   { return D.season_history || {}; },
    async getTradedPicks()     { return D.traded_picks || []; },
    async getDivisions()       { return D.divisions || {}; },
    async getPlayerNameMap()   { return D.player_name_map || {}; },
    async getPlayerValues()    { return D.player_values || {}; },
};
