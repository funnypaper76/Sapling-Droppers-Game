// Vercel serverless function: shared Sapling Droppers play counter.
// Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// (or KV_REST_API_URL and KV_REST_API_TOKEN) in Vercel Environment Variables.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const COUNT_KEY = "sapling-droppers:global-plays";

async function redis(command) {
  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + REDIS_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error("Redis request failed");
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.result;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: "Counter storage is not configured" });
  }

  try {
    if (req.method === "GET") {
      const value = await redis(["GET", COUNT_KEY]);
      return res.status(200).json({ plays: Number(value) || 0 });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).end();
    }

    const roundId = req.body && req.body.roundId;
    if (typeof roundId !== "string" || !/^[0-9a-f-]{36}$/i.test(roundId)) {
      return res.status(400).json({ error: "A valid round ID is required" });
    }

    // Idempotency: a given campaign ID can only increment once.
    const claimed = await redis([
      "SET", "sapling-droppers:round:" + roundId, "1", "NX", "EX", 86400
    ]);
    let plays;
    if (claimed === "OK") {
      plays = await redis(["INCR", COUNT_KEY]);
    } else {
      plays = await redis(["GET", COUNT_KEY]);
    }
    return res.status(200).json({
      plays: Number(plays) || 0,
      counted: claimed === "OK"
    });
  } catch (error) {
    console.error("Sapling Droppers counter error:", error);
    return res.status(500).json({ error: "Counter temporarily unavailable" });
  }
};
