import { config } from "dotenv";
import { embed } from "../src/lib/embeddings";

config({ path: ".env.local" });

async function main(): Promise<void> {
  console.log("Embedding 'hello world' as a document via voyage-3-large…");
  const start = Date.now();
  const [vector] = await embed(["hello world"], "document");
  const elapsedMs = Date.now() - start;

  if (!vector) {
    throw new Error("Voyage returned no embedding");
  }

  console.log(`returned ${vector.length}-dim vector in ${elapsedMs}ms`);
  console.log(
    `first 5 dims: [${vector
      .slice(0, 5)
      .map((n) => n.toFixed(6))
      .join(", ")}]`,
  );

  if (vector.length !== 1024) {
    throw new Error(`Expected 1024-dim vector, got ${vector.length}`);
  }

  console.log("OK — 1024 dimensions confirmed.");
}

main().catch((err: unknown) => {
  console.error("voyage-test failed:", err);
  process.exit(1);
});
