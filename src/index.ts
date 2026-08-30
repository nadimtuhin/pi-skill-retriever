/**
 * pi-skill-retriever — skill retrieval for the Pi coding agent
 *
 * Two-stage retrieval:
 *   1. Keyword pre-filter (free): score prompt vs skill name+description
 *   2. LLM gate (optional): one model call picks best 3-5 from top candidates
 *
 * Injects the winners as a hidden context message telling the agent which
 * SKILL.md files to read first.
 *
 * Commands:
 *   /sr            - show status
 *   /sr off|on     - toggle injection
 *   /sr llm on|off - toggle LLM gate (default: on when model available)
 *   /sr <query>    - manual retrieval preview
 *
 * Inspired by the Hermes Agent skill-retriever plugin (MIT, Donald Thompson
 * and contributors) — adapted to run in-process in Pi.
 *
 * MIT License. See LICENSE.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PiSkill {
	name: string;
	description: string;
	filePath: string;
	disableModelInvocation: boolean;
}

export interface ScoredSkill {
	skill: PiSkill;
	score: number;
}

/** Max skills injected per turn. */
export const MAX_INJECT = 5;
/** Minimum keyword score for a skill to reach the LLM gate. */
export const MIN_SCORE = 2;
/** Max candidates passed to the LLM gate. */
export const MAX_CANDIDATES = 20;

const STOP = new Set([
	"the", "a", "an", "is", "are", "was", "were", "be", "been", "to", "of", "in",
	"on", "for", "with", "and", "or", "not", "it", "this", "that", "these",
	"those", "i", "you", "we", "they", "my", "your", "our", "me", "us", "do",
	"does", "did", "can", "could", "should", "would", "will", "have", "has",
	"had", "how", "what", "why", "when", "where", "which", "who", "if", "then",
	"else", "so", "at", "by", "from", "as", "but", "about", "into", "out", "up",
	"get", "make", "need", "want", "use", "using", "like", "just", "also",
]);

/** Tokenize text into lowercase terms, dropping stopwords and single chars. */
export function tokenize(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9_-]+/g) ?? []).filter(
		(t) => t.length > 1 && !STOP.has(t),
	);
}

/** Score skills against a prompt: name match = 2, description match = 1. */
export function scoreSkills(prompt: string, skills: PiSkill[]): ScoredSkill[] {
	const tokens = tokenize(prompt);
	if (tokens.length === 0) return [];

	const scored: ScoredSkill[] = [];
	for (const skill of skills) {
		if (skill.disableModelInvocation) continue;
		const name = skill.name.toLowerCase();
		const desc = (skill.description ?? "").toLowerCase();
		let score = 0;
		for (const t of tokens) {
			if (name.includes(t)) score += 2;
			else if (desc.includes(t)) score += 1;
		}
		if (score > 0) scored.push({ skill, score });
	}
	return scored.sort((a, b) => b.score - a.score);
}

/** Format matched skills into the hidden hint block injected into the turn. */
export function hintBlock(matches: PiSkill[]): string {
	const lines = [
		"[Skill Retriever]",
		"",
		"These skills match the current task. Read the SKILL.md before working:",
		"",
	];
	for (const skill of matches) {
		lines.push(`  - ${skill.name}: ${skill.filePath}`);
		lines.push(`    ${skill.description.slice(0, 160)}`);
	}
	lines.push("", "Load only those genuinely relevant. Skip if none apply.");
	return lines.join("\n");
}

const GATE_PROMPT = `You are a skill curator for a coding agent. From the candidate skills, pick the ones genuinely relevant to the task. Respond with valid JSON only — no markdown fences, no commentary.

Rules:
- Pick 0-5 skills. Fewer is better. Empty array if none truly apply.
- Prefer broad umbrella skills over narrow duplicates.
- Each entry: {"name": "<exact name from list>"}

Candidates:
{candidates}

Task:
{task}

JSON array of names:`;

/** One LLM call to pick best skills from keyword candidates. Returns names, or null on any failure (caller falls back to keyword order). */
export async function llmGate(
	complete: (prompt: string) => Promise<string>,
	task: string,
	candidates: ScoredSkill[],
): Promise<string[] | null> {
	if (candidates.length <= MAX_INJECT) return null; // nothing to narrow
	const list = candidates
		.slice(0, MAX_CANDIDATES)
		.map((c) => `- ${c.skill.name}: ${c.skill.description.slice(0, 150)}`)
		.join("\n");
	let text: string;
	try {
		text = await complete(GATE_PROMPT.replace("{candidates}", list).replace("{task}", task));
	} catch {
		return null;
	}
	if (!text) return null;
	const stripped = text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
	const match = stripped.match(/\[[\s\S]*\]/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]);
		if (!Array.isArray(parsed)) return null;
		// keep only known names, preserve skill objects
		const known = new Set(candidates.map((c) => c.skill.name));
		const names = parsed
			.filter((n) => typeof n === "string" || (n && typeof n.name === "string"))
			.map((n) => (typeof n === "string" ? n : n.name))
			.filter((n: string) => known.has(n));
		return names.length > 0 ? names.slice(0, MAX_INJECT) : null;
	} catch {
		return null;
	}
}

export default function skillRetrieverExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let llmEnabled = true;
	let lastSkills: PiSkill[] = [];

	function getSkills(event: { systemPromptOptions?: { skills?: PiSkill[] } }): PiSkill[] {
		return (event.systemPromptOptions?.skills ?? []).filter((s) => s && s.name);
	}

	async function select(prompt: string, ctx: ExtensionContext): Promise<PiSkill[]> {
		let candidates = scoreSkills(prompt, lastSkills).filter((m) => m.score >= MIN_SCORE);
		if (candidates.length === 0) return [];

		if (llmEnabled) {
			try {
				const model = ctx.model;
				if (model) {
					const names = await llmGate(
						(p) =>
							ctx.modelRegistry.complete(model, {
								messages: [{ role: "user", content: [{ type: "text", text: p }], timestamp: Date.now() }],
							}, { maxTokens: 300, cacheRetention: "none" }).then((r) =>
								r.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n"),
							),
						prompt,
						candidates,
					);
					if (names) {
						const byName = new Map(candidates.map((c) => [c.skill.name, c.skill]));
						return names.map((n) => byName.get(n)!).filter(Boolean);
					}
				}
			} catch {
				// fall through to keyword order
			}
		}
		return candidates.slice(0, MAX_INJECT).map((c) => c.skill);
	}

	pi.registerCommand("sr", {
		description: "Skill retriever: /sr off|on|llm on|off|<query>",
		handler: async (args: string, ctx: ExtensionContext) => {
			const arg = (args ?? "").trim();
			if (arg === "off" || arg === "on") {
				enabled = arg === "on";
				ctx.ui.notify(`skill-retriever: ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (arg === "llm on" || arg === "llm off") {
				llmEnabled = arg.endsWith("on");
				ctx.ui.notify(`skill-retriever: LLM gate ${llmEnabled ? "on" : "off"}`, "info");
				return;
			}
			if (!arg) {
				ctx.ui.notify(
					`skill-retriever: ${enabled ? "on" : "off"}, llm ${llmEnabled ? "on" : "off"}, ${lastSkills.length} skills indexed`,
					"info",
				);
				return;
			}
			const matches = await select(arg, ctx);
			if (matches.length === 0) {
				ctx.ui.notify("skill-retriever: no matches", "info");
				return;
			}
			pi.sendMessage({
				customType: "skill-retriever-preview",
				content: hintBlock(matches),
				display: true,
			});
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!enabled) return;
		lastSkills = getSkills(event);
		if (lastSkills.length === 0) return;

		const matches = await select(event.prompt, ctx);
		if (matches.length === 0) return;

		return {
			message: {
				customType: "skill-retriever",
				content: hintBlock(matches),
				display: false,
			},
		};
	});
}
