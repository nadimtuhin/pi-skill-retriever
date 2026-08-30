import { describe, expect, test } from "bun:test";
import { scoreSkills, tokenize, hintBlock, llmGate, MIN_SCORE } from "./index";

const skills = [
	{ name: "prisma-expert", description: "Prisma ORM patterns, transactions, migrations", filePath: "/skills/prisma-expert/SKILL.md", disableModelInvocation: false },
	{ name: "n8n-expression-syntax", description: "n8n expression syntax and evaluation", filePath: "/skills/n8n-expression-syntax/SKILL.md", disableModelInvocation: false },
	{ name: "n8n-node-configuration", description: "n8n node configuration", filePath: "/skills/n8n-node-configuration/SKILL.md", disableModelInvocation: false },
	{ name: "n8n-workflow-patterns", description: "n8n workflow patterns", filePath: "/skills/n8n-workflow-patterns/SKILL.md", disableModelInvocation: false },
	{ name: "n8n-code-javascript", description: "n8n javascript code nodes", filePath: "/skills/n8n-code-javascript/SKILL.md", disableModelInvocation: false },
	{ name: "n8n-validation-expert", description: "n8n validation", filePath: "/skills/n8n-validation-expert/SKILL.md", disableModelInvocation: false },
	{ name: "hidden-skill", description: "prisma transactions", filePath: "/skills/hidden/SKILL.md", disableModelInvocation: true },
	{ name: "unrelated", description: "cooking recipes", filePath: "/skills/unrelated/SKILL.md", disableModelInvocation: false },
];

test("tokenize drops stopwords and single chars", () => {
	expect(tokenize("The a prisma is transaction")).toEqual(["prisma", "transaction"]);
});

test("name match outweighs description match", () => {
	const scored = scoreSkills("prisma transaction hangs", skills);
	expect(scored[0].skill.name).toBe("prisma-expert");
	expect(scored[0].score).toBeGreaterThanOrEqual(MIN_SCORE);
});

test("disableModelInvocation skills are excluded", () => {
	const scored = scoreSkills("prisma transaction", skills);
	expect(scored.find((s) => s.skill.name === "hidden-skill")).toBeUndefined();
});

test("no match returns empty", () => {
	expect(scoreSkills("cooking pasta", skills).map((s) => s.skill.name)).toEqual(["unrelated"]);
	expect(scoreSkills("quantum physics", skills)).toEqual([]);
});

test("hintBlock lists skill paths", () => {
	const block = hintBlock([skills[0]]);
	expect(block).toContain("[Skill Retriever]");
	expect(block).toContain("/skills/prisma-expert/SKILL.md");
});

// ── LLM gate ─────────────────────────────────────────────────────────────

const manyCandidates = [
	...skills.filter((s) => s.name.startsWith("n8n")),
	skills[0],
].map((s) => ({ skill: s, score: 3 }));

test("llmGate parses clean JSON array", async () => {
	const complete = async () => '["n8n-expression-syntax", "n8n-code-javascript"]';
	const names = await llmGate(complete, "n8n expression fails", manyCandidates);
	expect(names).toEqual(["n8n-expression-syntax", "n8n-code-javascript"]);
});

test("llmGate strips markdown fences", async () => {
	const complete = async () => '```json\n[{"name": "n8n-expression-syntax"}]\n```';
	const names = await llmGate(complete, "task", manyCandidates);
	expect(names).toEqual(["n8n-expression-syntax"]);
});

test("llmGate rejects unknown names", async () => {
	const complete = async () => '["made-up-skill", "n8n-expression-syntax"]';
	const names = await llmGate(complete, "task", manyCandidates);
	expect(names).toEqual(["n8n-expression-syntax"]);
});

test("llmGate returns null on provider error (keyword fallback)", async () => {
	const complete = async () => { throw new Error("boom"); };
	const names = await llmGate(complete, "task", manyCandidates);
	expect(names).toBeNull();
});

test("llmGate returns null on garbage output", async () => {
	const complete = async () => "I think n8n expression skill is best";
	const names = await llmGate(complete, "task", manyCandidates);
	expect(names).toBeNull();
});

test("llmGate skips call when candidates <= MAX_INJECT", async () => {
	let called = false;
	const complete = async () => { called = true; return "[]"; };
	const names = await llmGate(complete, "task", manyCandidates.slice(0, 3));
	expect(names).toBeNull();
	expect(called).toBe(false);
});
