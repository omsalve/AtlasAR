import { spawnSync } from "node:child_process";
const compile = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "tests/data.test.ts", "--outDir", ".test-build", "--module", "commonjs", "--moduleResolution", "node", "--target", "ES2022", "--esModuleInterop", "--skipLibCheck", "--strict"], { stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
const test = spawnSync(process.execPath, ["--test", ".test-build/tests/data.test.js"], { stdio: "inherit" });
process.exit(test.status ?? 1);
