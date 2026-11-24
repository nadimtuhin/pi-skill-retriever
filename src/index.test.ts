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

// ── regression tests ─────────────────────────────────────────────────────

const mk = (name: string, description: string) => ({
	name,
	description,
	filePath: `/skills/${name}/SKILL.md`,
	disableModelInvocation: false,
});

test("tokenize keeps non-ASCII words intact", () => {
	expect(tokenize("Résumé formatter für Café")).toEqual(["résumé", "formatter", "für", "café"]);
	expect(tokenize("настроить базу данных")).toEqual(["настроить", "базу", "данных"]);
});

test("non-ASCII prompt does not match unrelated skills via ASCII fragments", () => {
	const pool = [mk("summary-writer", "summarize documents"), mk("résumé-builder", "build a résumé")];
	const names = scoreSkills("résumé", pool).map((s) => s.skill.name);
	expect(names).toEqual(["résumé-builder"]);
});

test("short tokens do not match in the middle of words", () => {
	const pool = [mk("mongodb", "MongoDB queries"), mk("golang", "Go language idioms")];
	const names = scoreSkills("go", pool).map((s) => s.skill.name);
	expect(names).toEqual(["golang"]);
});

test("repeated prompt words do not inflate a skill's score", () => {
	const pool = [mk("test-utils", "helpers"), mk("job-runner", "test runner for jobs")];
	const scored = scoreSkills("test test test runner", pool);
	expect(scored[0].skill.name).toBe("job-runner");
});

test("skills with a missing description do not crash formatting", async () => {
	const bare = { name: "bare", filePath: "/skills/bare/SKILL.md", disableModelInvocation: false } as any;
	expect(() => hintBlock([bare])).not.toThrow();
	const cands = [...manyCandidates, { skill: bare, score: 3 }];
	const names = await llmGate(async () => '["bare"]', "task", cands);
	expect(names).toEqual(["bare"]);
});

test("llmGate drops duplicate names", async () => {
	const complete = async () => '["n8n-expression-syntax", {"name": "n8n-expression-syntax"}, "n8n-code-javascript"]';
	const names = await llmGate(complete, "task", manyCandidates);
	expect(names).toEqual(["n8n-expression-syntax", "n8n-code-javascript"]);
});

test("hyphenated and decomposed-unicode prompt tokens still match", () => {
	const pool = [mk("n8n-expression-syntax", "expressions"), mk("café-guide", "coffee")];
	expect(scoreSkills("fix n8n-expression bug", pool)[0].skill.name).toBe("n8n-expression-syntax");
	expect(scoreSkills("café tips", pool)[0]?.skill.name).toBe("café-guide");
});
