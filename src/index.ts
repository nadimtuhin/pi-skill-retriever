/**
 * pi-skill-retriever — keyword-based skill retrieval for the Pi coding agent
 *
 * On each turn, scores the user prompt against all discovered skills
 * (name + description) and injects the top matches as a hidden context
 * message telling the agent which SKILL.md files to read first.
 *
 * Commands:
 *   /sr            - show status
 *   /sr off|on     - toggle
 *   /sr <query>    - manual retrieval preview
 *
 * Inspired by the Hermes Agent skill-retriever plugin (MIT, Donald Thompson
 * and contributors) — flat keyword pre-filter approach, adapted to run
 * in-process in Pi with zero LLM calls.
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
/** Minimum score for a skill to be injected. */
export const MIN_SCORE = 2;

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
export function hintBlock(matches: ScoredSkill[]): string {
	const lines = [
		"[Skill Retriever]",
		"",
		"These skills match the current task. Read the SKILL.md before working:",
		"",
	];
	for (const { skill } of matches) {
		lines.push(`  - ${skill.name}: ${skill.filePath}`);
		lines.push(`    ${skill.description.slice(0, 160)}`);
	}
	lines.push("", "Load only those genuinely relevant. Skip if none apply.");
	return lines.join("\n");
}

export default function skillRetrieverExtension(pi: ExtensionAPI): void {
	let enabled = true;
	let lastSkills: PiSkill[] = [];

	function getSkills(event: { systemPromptOptions?: { skills?: PiSkill[] } }): PiSkill[] {
		return (event.systemPromptOptions?.skills ?? []).filter((s) => s && s.name);
	}

	pi.registerCommand("sr", {
		description: "Skill retriever: /sr off|on|<query>",
		handler: async (args: string, ctx: ExtensionContext) => {
			const arg = (args ?? "").trim();
			if (arg === "off" || arg === "on") {
				enabled = arg === "on";
				ctx.ui.notify(`skill-retriever: ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (!arg) {
				ctx.ui.notify(
					`skill-retriever: ${enabled ? "on" : "off"}, ${lastSkills.length} skills indexed. /sr <query> to test.`,
					"info",
				);
				return;
			}
			const matches = scoreSkills(arg, lastSkills).slice(0, MAX_INJECT);
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

	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		lastSkills = getSkills(event);
		if (lastSkills.length === 0) return;

		const matches = scoreSkills(event.prompt, lastSkills)
			.filter((m) => m.score >= MIN_SCORE)
			.slice(0, MAX_INJECT);
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
