// generate-story: creates a ~1-minute personalized bedtime story for one child.
// Runs server-side so the Anthropic key never reaches the browser.
import Anthropic from "npm:@anthropic-ai/sdk@0.132.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.132.0/helpers/zod";
import { z } from "npm:zod@4.6.5";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

const MODEL = Deno.env.get("STORY_MODEL") ?? "claude-haiku-5-5";
const FREE_STORIES_PER_WEEK = 3;
const LESSONS = [
  "kindness", "courage", "honesty", "patience", "confidence", "sharing",
  "friendship", "gratitude", "listening", "faith", "trying new things", "bedtime calm",
];
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://jcoleman304.github.io,http://localhost:8000,http://127.0.0.1:8000").split(",");

const StorySchema = z.object({
  title: z.string(),
  story: z.string(),
});
const SafetySchema = z.object({
  safe: z.boolean(),
  reason: z.string(),
});

const SYSTEM = `You write personalized bedtime stories for children ages 3 to 10.

Rules that never bend:
- The story must be gentle, warm, and calming. It is read right before sleep.
- Length: 140 to 170 words. It must take about one minute to read aloud. Never exceed 180 words.
- No violence, scary content, villains who threaten harm, death, injury, weapons, romance, body commentary, brands, or real public figures.
- No religious content unless the lesson is "faith"; then keep it simple, warm, and non-denominational (gratitude, trust, hope).
- Use the child's name as the hero. Weave in their favorite things naturally; do not list them.
- Show the lesson through what the child does in the story. End with the child feeling safe, loved, and sleepy.
- Simple sentences. Vocabulary matched to the age range. Light, playful, imaginative.
- The title is 2 to 6 words and never contains the word "story".
- Do not address the parent. Do not add a moral paragraph at the end. Do not use emojis.`;

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, headers);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Client scoped to the calling parent (RLS applies).
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "unauthorized" }, 401, headers);

  let payload: { child_id?: string; lesson?: string; continue_from?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400, headers);
  }
  const lesson = (payload.lesson ?? "").toLowerCase().trim();
  if (!payload.child_id || !LESSONS.includes(lesson)) {
    return json({ error: "bad_request", lessons: LESSONS }, 400, headers);
  }

  const { data: child } = await userClient
    .from("children").select("*").eq("id", payload.child_id).maybeSingle();
  if (!child) return json({ error: "child_not_found" }, 404, headers);

  // Service client for quota + insert (bypasses RLS; scoped by parent_id below).
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await admin
    .from("profiles").select("plan").eq("id", user.id).maybeSingle();
  const plan = profile?.plan ?? "free";

  if (plan === "free") {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("stories").select("id", { count: "exact", head: true })
      .eq("parent_id", user.id).gte("created_at", since);
    if ((count ?? 0) >= FREE_STORIES_PER_WEEK) {
      return json({ error: "quota", limit: FREE_STORIES_PER_WEEK }, 402, headers);
    }
  }

  let previous: { title: string; body: string } | null = null;
  if (payload.continue_from) {
    const { data: prev } = await userClient
      .from("stories").select("title, body").eq("id", payload.continue_from).maybeSingle();
    previous = prev ?? null;
  }

  const favorites = [
    child.favorite_color && `favorite color: ${child.favorite_color}`,
    child.favorite_food && `favorite food: ${child.favorite_food}`,
    child.favorite_animal && `favorite animal: ${child.favorite_animal}`,
    child.favorite_place && `favorite place: ${child.favorite_place}`,
    child.favorite_activity && `favorite activity: ${child.favorite_activity}`,
  ].filter(Boolean).join("\n");

  const prompt = [
    `Child's name: ${child.name}`,
    `Age range: ${child.age_range ?? "5-6"}`,
    favorites,
    `Tonight's lesson: ${lesson}`,
    previous
      ? `This is a continuing adventure. Last night's story was titled "${previous.title}":\n${previous.body}\n\nWrite tonight's new chapter. Keep the same world and friends, and make it a fresh adventure that stands on its own.`
      : "Write tonight's story.",
  ].filter(Boolean).join("\n\n");

  const anthropic = new Anthropic();

  async function writeStory() {
    const res = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(StorySchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("refusal");
    if (!res.parsed_output) throw new Error("parse_failed");
    return res.parsed_output;
  }

  async function isSafe(story: { title: string; story: string }) {
    const res = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 512,
      output_config: { effort: "low", format: zodOutputFormat(SafetySchema) },
      system:
        "You are a children's content safety reviewer. Approve only stories that are gentle, age-appropriate for ages 3 to 10, free of violence, fear, injury, death, weapons, romance, brands, and real people, and calming enough for bedtime. Be strict.",
      messages: [{
        role: "user",
        content: `Title: ${story.title}\n\n${story.story}`,
      }],
    });
    return res.parsed_output?.safe === true;
  }

  let story: { title: string; story: string } | null = null;
  try {
    for (let attempt = 0; attempt < 2 && !story; attempt++) {
      const candidate = await writeStory();
      if (await isSafe(candidate)) story = candidate;
    }
  } catch (e) {
    console.error("generation failed", e);
    return json({ error: "generation_failed" }, 502, headers);
  }
  if (!story) return json({ error: "safety_rejected" }, 502, headers);

  const { data: saved, error: insertErr } = await admin
    .from("stories")
    .insert({
      parent_id: user.id,
      child_id: child.id,
      title: story.title.trim(),
      body: story.story.trim(),
      lesson,
      continues_from: payload.continue_from ?? null,
    })
    .select("*")
    .single();
  if (insertErr) {
    console.error("insert failed", insertErr);
    return json({ error: "save_failed" }, 500, headers);
  }

  return json({ story: saved, plan }, 200, headers);
});
