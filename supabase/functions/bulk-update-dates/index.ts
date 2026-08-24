// One-off admin endpoint to bulk-update bills.date by bill_no.
// POST { updates: [{bn:string, d:string}, ...] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const updates: Array<{ bn: string; d: string }> = body.updates || [];
    if (!updates.length) return new Response(JSON.stringify({ updated: 0 }), { headers: { ...cors, "content-type": "application/json" } });

    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supa = createClient(url, key);

    // Build a single UPDATE ... FROM (VALUES ...) via rpc-less approach: use pg through PostgREST is not possible.
    // Instead, use batched update via .update per unique date group to minimize round-trips.
    const byDate = new Map<string, string[]>();
    for (const u of updates) {
      if (!u?.bn || !u?.d) continue;
      const arr = byDate.get(u.d) || [];
      arr.push(u.bn);
      byDate.set(u.d, arr);
    }
    let updated = 0;
    for (const [d, bns] of byDate.entries()) {
      // Chunk .in() to 500 to stay within URL limits
      for (let i = 0; i < bns.length; i += 500) {
        const slice = bns.slice(i, i + 500);
        const { error, count } = await supa
          .from("bills")
          .update({ date: d }, { count: "exact" })
          .in("bill_no", slice);
        if (error) return new Response(JSON.stringify({ error: error.message, d, sample: slice.slice(0, 3) }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
        updated += count || 0;
      }
    }
    return new Response(JSON.stringify({ updated, groups: byDate.size }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }
});
