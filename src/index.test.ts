import { describe, expect, test } from "bun:test";
import { scoreSkills, tokenize, hintBlock, MIN_SCORE } from "./index";

const skills = [
	{ name: "prisma-expert", description: "Prisma ORM patterns, transactions, migrations", filePath: "/skills/prisma-expert/SKILL.md", disableModelInvocation: false },
	{ name: "n8n-expression-syntax", description: "n8n expression syntax and evaluation", filePath: "/skills/n8n-expression-syntax/SKILL.md", disableModelInvocation: false },
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
	const block = hintBlock(scoreSkills("prisma transaction hangs", skills));
	expect(block).toContain("[Skill Retriever]");
	expect(block).toContain("/skills/prisma-expert/SKILL.md");
});
