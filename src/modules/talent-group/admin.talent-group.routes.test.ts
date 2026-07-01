import assert from "node:assert/strict";
import test from "node:test";
import { adminTalentGroupRoutes } from "./admin/admin.talent-group.routes";

function controller(): never {
  return {
    execute(_req: unknown, res: { status: (code: number) => { end: () => void } }) {
      res.status(204).end();
    },
  } as never;
}

test("TalentGroup admin routes do not expose legacy manager-assignment wrapper endpoints", () => {
  const router = adminTalentGroupRoutes(controller(), controller());
  const registeredPaths = (
    router as unknown as {
      stack: Array<{ route?: { path?: string } }>;
    }
  ).stack
    .map((layer) => layer.route?.path)
    .filter((path): path is string => typeof path === "string");

  assert.equal(
    registeredPaths.some((path) => path.includes("manager-assignments")),
    false,
  );
});
