(() => {
  "use strict";

  const SUPABASE_URL = "YOUR_SUPABASE_URL"; // TODO: Task 6에서 실제 Supabase Project URL로 교체
  const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"; // TODO: Task 6에서 실제 anon public key로 교체
  const TABLE_NAME = "leaderboard";
  const TOP_N = 10;

  let client = null;
  function getClient() {
    if (client) return client;
    if (!window.supabase || SUPABASE_URL.startsWith("YOUR_")) return null;
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return client;
  }

  async function fetchTopScores(limit = TOP_N) {
    const supabase = getClient();
    if (!supabase) throw new Error("Supabase가 아직 설정되지 않았습니다.");
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("name, score")
      .order("score", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  }

  async function submitScore(name, score) {
    const supabase = getClient();
    if (!supabase) throw new Error("Supabase가 아직 설정되지 않았습니다.");
    const trimmed = String(name).trim().slice(0, 12) || "익명";
    const { error } = await supabase.from(TABLE_NAME).insert({ name: trimmed, score });
    if (error) throw error;
  }

  async function getRankForScore(score) {
    const top = await fetchTopScores(TOP_N);
    if (top.length < TOP_N) {
      let insertAt = top.findIndex((row) => score > row.score);
      if (insertAt === -1) insertAt = top.length;
      return { qualifies: true, rank: insertAt + 1, top };
    }
    const insertAt = top.findIndex((row) => score > row.score);
    if (insertAt === -1) return { qualifies: false, rank: null, top };
    return { qualifies: true, rank: insertAt + 1, top };
  }

  window.Leaderboard = { fetchTopScores, submitScore, getRankForScore };
})();
