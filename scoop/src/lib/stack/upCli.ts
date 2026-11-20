import { loadStackConfig } from "@/lib/stack/config";
import { bringUpStack } from "@/lib/stack/up";

const result = await bringUpStack(loadStackConfig());
for (const line of result.lines) {
  console.log(line);
}
process.exitCode = result.failed ? 1 : 0;
