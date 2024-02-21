/**
 * @fileoverview Forbid using arbitrary values in classnames
 * @author François Massart
 */
'use strict';

const docsUrl = require('../util/docsUrl');
const customConfig = require('../util/customConfig');
const astUtil = require('../util/ast');
const groupUtil = require('../util/groupMethods');
const getOption = require('../util/settings');
const parserUtil = require('../util/parser');
const traverseObject = require('../util/traverseObject');

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

// Predefine message for use in context.report conditional.
// messageId will still be usable in tests.
const ARBITRARY_VALUE_DETECTED_MSG = `Arbitrary value: {{arbitraryValue}} already defined by '{{definedToken}}'`;

module.exports = {
  meta: {
    docs: {
      description: 'Forbid using arbitrary values which already defined in Tailwind CSS theme',
      category: 'Best Practices',
      recommended: false,
      url: docsUrl('no-defined-arbitrary-value'),
    },
    messages: {
      arbitraryValueAlreadyDefined: ARBITRARY_VALUE_DETECTED_MSG,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          callees: {
            type: 'array',
            items: { type: 'string', minLength: 0 },
            uniqueItems: true,
          },
          ignoredKeys: {
            type: 'array',
            items: { type: 'string', minLength: 0 },
            uniqueItems: true,
          },
          config: {
            // returned from `loadConfig()` utility
            type: ['string', 'object'],
          },
          tags: {
            type: 'array',
            items: { type: 'string', minLength: 0 },
            uniqueItems: true,
          },
        },
      },
    ],
  },

  create: function (context) {
    const callees = getOption(context, 'callees');
    const skipClassAttribute = getOption(context, 'skipClassAttribute');
    const tags = getOption(context, 'tags');
    const twConfig = getOption(context, 'config');
    const classRegex = getOption(context, 'classRegex');

    const mergedConfig = customConfig.resolve(twConfig);

    const map = new Map();
    traverseObject(mergedConfig.theme.colors, (value, path) => {
        if (map.has(value)) {
            const pathList = map.get(value);
            pathList.push(path.join('-'));
        }
        else {
            map.set(value, [path.join('-')]);
        }
    });

    //----------------------------------------------------------------------
    // Helpers
    //----------------------------------------------------------------------

    /**
     * Recursive function crawling into child nodes
     * @param {ASTNode} node The root node of the current parsing
     * @param {ASTNode} arg The child node of node
     * @returns {void}
     */
    const parseForArbitraryValues = (node, arg = null) => {
      let originalClassNamesValue = null;
      let start = null;
      let end = null;

      if (arg === null) {
        originalClassNamesValue = astUtil.extractValueFromNode(node);
        const range = astUtil.extractRangeFromNode(node);
        if (node.type === 'TextAttribute') {
            start = range[0];
            end = range[1];
          } else {
            start = range[0] + 1;
            end = range[1] - 1;
        }

      } else {
        switch (arg.type) {
          case 'Identifier':
            return;
          case 'TemplateLiteral':
            arg.expressions.forEach((exp) => {
              parseForArbitraryValues(node, exp);
            });
            arg.quasis.forEach((quasis) => {
              parseForArbitraryValues(node, quasis);
            });
            return;
          case 'ConditionalExpression':
            parseForArbitraryValues(node, arg.consequent);
            parseForArbitraryValues(node, arg.alternate);
            return;
          case 'LogicalExpression':
            parseForArbitraryValues(node, arg.right);
            return;
          case 'ArrayExpression':
            arg.elements.forEach((el) => {
              parseForArbitraryValues(node, el);
            });
            return;
          case 'ObjectExpression':
            const isUsedByClassNamesPlugin = node.callee && node.callee.name === 'classnames';
            const isVue = node.key && node.key.type === 'VDirectiveKey';
            arg.properties.forEach((prop) => {
              const propVal = isUsedByClassNamesPlugin || isVue ? prop.key : prop.value;
              parseForArbitraryValues(node, propVal);
            });
            return;
          case 'Property':
            parseForArbitraryValues(node, arg.key);
            return;
          case 'Literal':
            originalClassNamesValue = arg.value;
            start = arg.range[0] + 1;
            end = arg.range[1] - 1;

            break;
          case 'TemplateElement':
            originalClassNamesValue = arg.value.raw;
            if (originalClassNamesValue === '') {
              return;
            }
            start = arg.range[0];
            end = arg.range[1];
            break;
        }
      }

      let { classNames, classNamesIndex } = astUtil.extractClassnamesFromValue(originalClassNamesValue);

      const forbidden = [];
      classNames.forEach((cls, idx) => {
        const parsed = groupUtil.parseClassname(cls, [], mergedConfig, idx);

        const arbitraryValue = parsed.name.match(/\[(.*)\]/i);
        if (arbitraryValue) {
            const [matched, key] = arbitraryValue;
            const definedToken = map.get(key);

            if (map.has(key)) {
                forbidden.push({
                    arbitraryValue: key,
                    definedToken,
                    fixInfo: {
                        start: start + classNamesIndex[idx],
                        end: start + classNamesIndex[idx] + parsed.name.length,
                        fixed: parsed.name.replace(matched, definedToken[0].endsWith('-DEFAULT') ? definedToken[0].slice(0, -8) : definedToken[0])
                    }
                });
            }
        }
      });

      forbidden.forEach((data) => {
        context.report({
          node,
          messageId: 'arbitraryValueAlreadyDefined',
          data,
          fix: function(fixer) {
            const {start, end, fixed} = data.fixInfo;
            return fixer.replaceTextRange([start, end], fixed)
          }
        });
      });
    };

    //----------------------------------------------------------------------
    // Public
    //----------------------------------------------------------------------

    const attributeVisitor = function (node) {
      if (!astUtil.isClassAttribute(node, classRegex) || skipClassAttribute) {
        return;
      }
      if (astUtil.isLiteralAttributeValue(node)) {
        parseForArbitraryValues(node);
      } else if (node.value && node.value.type === 'JSXExpressionContainer') {
        parseForArbitraryValues(node, node.value.expression);
      }
    };

    const callExpressionVisitor = function (node) {
      const calleeStr = astUtil.calleeToString(node.callee);
      if (callees.findIndex((name) => calleeStr === name) === -1) {
        return;
      }
      node.arguments.forEach((arg) => {
        parseForArbitraryValues(node, arg);
      });
    };

    const scriptVisitor = {
      JSXAttribute: attributeVisitor,
      TextAttribute: attributeVisitor,
      CallExpression: callExpressionVisitor,
      TaggedTemplateExpression: function (node) {
        if (!tags.includes(node.tag.name)) {
          return;
        }
        parseForArbitraryValues(node, node.quasi);
      },
    };

    const templateVisitor = {
      CallExpression: callExpressionVisitor,
      /*
      Tagged templates inside data bindings
      https://github.com/vuejs/vue/issues/9721
      */
      VAttribute: function (node) {
        switch (true) {
          case !astUtil.isValidVueAttribute(node, classRegex):
            return;
          case astUtil.isVLiteralValue(node):
            parseForArbitraryValues(node, null);
            break;
          case astUtil.isArrayExpression(node):
            node.value.expression.elements.forEach((arg) => {
              parseForArbitraryValues(node, arg);
            });
            break;
          case astUtil.isObjectExpression(node):
            node.value.expression.properties.forEach((prop) => {
              parseForArbitraryValues(node, prop);
            });
            break;
        }
      },
    };

    return parserUtil.defineTemplateBodyVisitor(context, templateVisitor, scriptVisitor);
  },
};
