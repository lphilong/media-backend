import { Document } from "mongodb";

export function buildRoleAssignmentSuccessorPairClassificationExpression(): Document {
  const successorIdAbsent = {
    $eq: [{ $ifNull: ["$lifecycle.successorAssignmentId", null] }, null],
  };
  const successorCutoverAbsent = {
    $eq: [{ $ifNull: ["$lifecycle.successorEffectiveAt", null] }, null],
  };
  const validSuccessorId = {
    $cond: [
      { $eq: [{ $type: "$lifecycle.successorAssignmentId" }, "string"] },
      {
        $gt: [
          {
            $strLenCP: {
              $trim: { input: "$lifecycle.successorAssignmentId" },
            },
          },
          0,
        ],
      },
      false,
    ],
  };
  const validSuccessorCutover = {
    $and: [
      { $isNumber: "$lifecycle.successorEffectiveAt" },
      { $gte: ["$lifecycle.successorEffectiveAt", 0] },
      {
        $lt: ["$lifecycle.successorEffectiveAt", Number.POSITIVE_INFINITY],
      },
    ],
  };
  return {
    $cond: [
      { $and: [successorIdAbsent, successorCutoverAbsent] },
      "NO_SUCCESSOR",
      {
        $cond: [
          { $and: [validSuccessorId, validSuccessorCutover] },
          "VALID_SUCCESSOR",
          "MALFORMED_SUCCESSOR",
        ],
      },
    ],
  };
}

/**
 * A predecessor remains eligible only while it has no recorded successor or
 * its recorded successor has a valid future cutover. This expression is
 * intentionally state-agnostic so every authority-bearing nonterminal state
 * receives the same fail-closed cutover rule.
 */
export function buildRoleAssignmentSuccessorCutoverEligibilityExpression(
  now: number,
): Document {
  return {
    $let: {
      vars: {
        successorPair:
          buildRoleAssignmentSuccessorPairClassificationExpression(),
      },
      in: {
        $or: [
          { $eq: ["$$successorPair", "NO_SUCCESSOR"] },
          {
            $and: [
              { $eq: ["$$successorPair", "VALID_SUCCESSOR"] },
              { $gt: ["$lifecycle.successorEffectiveAt", now] },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Projects the exact future successor cutover without weakening current
 * authority's fail-closed boolean contract. Missing, malformed, exact-now,
 * and elapsed cutovers are not future lifecycle transitions.
 */
export function buildRoleAssignmentFutureSuccessorCutoverTransitionExpression(
  now: number,
): Document {
  return {
    $cond: [
      {
        $and: [
          {
            $eq: [
              buildRoleAssignmentSuccessorPairClassificationExpression(),
              "VALID_SUCCESSOR",
            ],
          },
          { $gt: ["$lifecycle.successorEffectiveAt", now] },
        ],
      },
      "$lifecycle.successorEffectiveAt",
      null,
    ],
  };
}
