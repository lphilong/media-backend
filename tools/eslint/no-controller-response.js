const FORBIDDEN_RESPONSE_METHODS = new Set([
  "json",
  "send",
  "end",
  "write",
  "redirect",
]);

const FORBIDDEN_RESPONSE_OBJECT_NAMES = new Set([
  "res",
  "response",
]);

function readPropertyName(memberExpression) {
  if (!memberExpression.computed) {
    if (memberExpression.property.type === "Identifier") {
      return memberExpression.property.name;
    }
    return null;
  }

  if (
    memberExpression.property.type === "Literal" &&
    typeof memberExpression.property.value === "string"
  ) {
    return memberExpression.property.value;
  }

  return null;
}

function isForbiddenResponseObject(node) {
  if (!node) {
    return false;
  }

  if (node.type === "Identifier") {
    return FORBIDDEN_RESPONSE_OBJECT_NAMES.has(node.name);
  }

  if (node.type === "MemberExpression") {
    const propertyName = readPropertyName(node);
    return FORBIDDEN_RESPONSE_OBJECT_NAMES.has(propertyName);
  }

  return false;
}

function extractCalledMember(callee) {
  if (!callee) {
    return null;
  }

  if (callee.type === "MemberExpression") {
    return callee;
  }

  if (
    callee.type === "ChainExpression" &&
    callee.expression.type === "MemberExpression"
  ) {
    return callee.expression;
  }

  return null;
}

function isForbiddenResponseTypeReference(typeNameNode) {
  if (typeNameNode.type === "Identifier") {
    return typeNameNode.name === "Response";
  }

  if (typeNameNode.type === "TSQualifiedName") {
    return typeNameNode.right.name === "Response";
  }

  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid Express Response access/manipulation in controller files.",
      recommended: true,
    },
    schema: [],
    messages: {
      responseImportForbidden:
        "Express Response import is forbidden in controller files.",
      responseTypeForbidden:
        "Response type reference is forbidden in controller files.",
      responseMethodForbidden:
        "Controller-side response method '{{method}}' is forbidden.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "express") {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "Response"
          ) {
            context.report({
              node: specifier,
              messageId: "responseImportForbidden",
            });
          }
        }
      },

      TSTypeReference(node) {
        if (
          isForbiddenResponseTypeReference(node.typeName)
        ) {
          context.report({
            node: node.typeName,
            messageId: "responseTypeForbidden",
          });
        }
      },

      CallExpression(node) {
        const memberExpression = extractCalledMember(
          node.callee,
        );
        if (!memberExpression) {
          return;
        }

        const methodName =
          readPropertyName(memberExpression);
        if (
          !FORBIDDEN_RESPONSE_METHODS.has(methodName)
        ) {
          return;
        }

        if (
          !isForbiddenResponseObject(
            memberExpression.object,
          )
        ) {
          return;
        }

        context.report({
          node: memberExpression.property,
          messageId: "responseMethodForbidden",
          data: {
            method: methodName,
          },
        });
      },
    };
  },
};
